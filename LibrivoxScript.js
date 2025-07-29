const PLATFORM = "Librivox";
const PLATFORM_BASE_URL = "https://librivox.org";
const LIBRIVOX_API_BASE = "https://librivox.org/api/feed";
const LIBRIVOX_AUDIOBOOKS_API = "https://librivox.org/api/feed/audiobooks";
const LIBRIVOX_AUTHORS_API = "https://librivox.org/api/feed/authors";
const LIBRIVOX_TRACKS_API = "https://librivox.org/api/feed/audiotracks";

// API URL templates
const API_SEARCH_URL_TEMPLATE = LIBRIVOX_AUDIOBOOKS_API + "?title={query}&format=json&extended=1&limit=50";
const API_SEARCH_AUTHOR_URL_TEMPLATE = LIBRIVOX_AUDIOBOOKS_API + "?author={author}&format=json&extended=1&limit=50";
const API_SEARCH_GENRE_URL_TEMPLATE = LIBRIVOX_AUDIOBOOKS_API + "?genre={genre}&format=json&extended=1&limit=50";
const API_GET_AUDIOBOOK_URL_TEMPLATE = LIBRIVOX_AUDIOBOOKS_API + "?id={id}&format=json&extended=1";
const API_GET_TRACKS_URL_TEMPLATE = LIBRIVOX_TRACKS_API + "?project_id={project_id}&format=json";
const API_GET_AUTHOR_URL_TEMPLATE = LIBRIVOX_AUTHORS_API + "?id={id}&format=json";

// URL patterns
const REGEX_AUDIOBOOK_URL = /https:\/\/librivox\.org\/([a-z0-9-]+)-?\/?$/i;
const REGEX_AUTHOR_URL = /https:\/\/librivox\.org\/author\/([a-z0-9-]+)\/?$/i;
const REGEX_AUDIOBOOK_ID = /id=(\d+)/;

let state = {};
let config = {};
let _settings = {
    allowExplicit: true,
    preferredLanguage: 0,
    contentRecommendationOptionIndex: 0
};

// Language mapping
const LANGUAGES = {
    0: "English",
    1: "French", 
    2: "German",
    3: "Spanish",
    4: "Italian",
    5: "Portuguese",
    6: "Dutch",
    7: null // All languages
};

// Source Methods
source.enable = function(conf, settings, savedState) {
    try {
        config = conf ?? {};
        _settings = settings ?? {};
        
        if(_settings.allowExplicit == undefined) {
            _settings.allowExplicit = true;
        }
        
        if(_settings.preferredLanguage == undefined) {
            _settings.preferredLanguage = 0;
        }
        
        if(_settings.contentRecommendationOptionIndex == undefined) {
            _settings.contentRecommendationOptionIndex = 0;
        }
        
        // No authentication needed for Librivox
        state = {};
        
    } catch(e) {
        console.error(e);
    }
}

source.getHome = function() {
    class LibrivoxHomePager extends VideoPager {
        constructor() {
            super([], true);
            this.offset = 0;
        }
        
        nextPage() {
            const language = LANGUAGES[_settings.preferredLanguage];
            let url = LIBRIVOX_AUDIOBOOKS_API + "?format=json&extended=1&limit=25&offset=" + this.offset;
            
            if (language && language !== "All Languages") {
                url += "&language=" + encodeURIComponent(language);
            }
            
            const data = makeGetRequest(url, { throwOnError: false });
            
            if (!data) {
                return new VideoPager([], false);
            }
            
            const audiobooks = data.books || [];
            const contents = audiobooks
                .map(book => audiobookToPlatformVideo(book))
                .filter(Boolean);
            
            this.offset += 25;
            this.hasMore = audiobooks.length === 25;
            this.results = contents;
            
            return this;
        }
    }
    
    return new LibrivoxHomePager().nextPage();
};

source.searchSuggestions = function(query) {
    try {
        if (!query || query.length < 2) {
            return [];
        }
        
        // Simple suggestions based on search
        return [
            query + " audiobook",
            query + " book",
            "author " + query
        ];
    } catch (error) {
        log('Failed to get search suggestions:' + error?.message);
        return [];
    }
};

source.getSearchCapabilities = () => {
    return {
        types: [Type.Feed.Mixed],
        sorts: [Type.Order.Chronological],
        filters: []
    };
};

source.search = function(query, type, order, filters) {
    if (!query) {
        return new ContentPager([], false);
    }
    
    const encodedQuery = encodeURIComponent(query);
    let searchUrl = API_SEARCH_URL_TEMPLATE.replace("{query}", encodedQuery);
    
    const language = LANGUAGES[_settings.preferredLanguage];
    if (language && language !== "All Languages") {
        searchUrl += "&language=" + encodeURIComponent(language);
    }
    
    const data = makeGetRequest(searchUrl, { throwOnError: false });
    
    if (!data) {
        return new ContentPager([], false);
    }
    
    const audiobooks = data.books || [];
    const results = audiobooks
        .map(book => audiobookToPlatformVideo(book))
        .filter(Boolean);
    
    return new ContentPager(results, false);
};

source.getSearchChannelContentsCapabilities = function() {
    return {
        types: [Type.Feed.Mixed],
        sorts: [Type.Order.Chronological],
        filters: []
    };
};

source.searchChannels = function(query) {
    if (!query) {
        return new ChannelPager([], false);
    }
    
    // Search for authors as channels
    const encodedQuery = encodeURIComponent(query);
    const url = LIBRIVOX_AUTHORS_API + "?last_name=" + encodedQuery + "&format=json";
    
    const data = makeGetRequest(url, { throwOnError: false });
    
    if (!data) {
        return new ChannelPager([], false);
    }
    
    const authors = data.authors || [];
    const results = authors.map(author => {
        return new PlatformAuthorLink(
            new PlatformID(PLATFORM, author.id.toString(), config.id),
            author.first_name + " " + author.last_name,
            "https://librivox.org/author/" + author.id,
            ""
        );
    });
    
    return new ChannelPager(results, false);
};

// Channel/Author handling
source.isChannelUrl = function(url) {
    return REGEX_AUTHOR_URL.test(url);
};

source.getChannel = function(url) {
    const match = url.match(REGEX_AUTHOR_URL);
    if (!match) {
        throw new ScriptException("Invalid author URL");
    }
    
    const authorId = match[1];
    
    // Get author details
    const authorUrl = API_GET_AUTHOR_URL_TEMPLATE.replace("{id}", authorId);
    const authorData = makeGetRequest(authorUrl, { throwOnError: false });
    
    if (!authorData || !authorData.authors || authorData.authors.length === 0) {
        throw new ScriptException("Failed to get author data");
    }
    
    const author = authorData.authors[0];
    const authorName = author.first_name + " " + author.last_name;
    
    // Get author's audiobooks
    const booksUrl = LIBRIVOX_AUDIOBOOKS_API + "?author=" + encodeURIComponent(author.last_name) + "&format=json&extended=1";
    const booksData = makeGetRequest(booksUrl, { throwOnError: false });
    
    let description = "Audiobooks by " + authorName;
    if (author.dob || author.dod) {
        description += "<br>Life: " + (author.dob || "?") + " - " + (author.dod || "?");
    }
    
    return new PlatformChannel({
        id: new PlatformID(PLATFORM, author.id.toString(), config.id),
        name: authorName,
        thumbnail: "https://librivox.org/images/librivox-logo.png",
        banner: "",
        subscribers: -1,
        description: description,
        url: url,
        links: {}
    });
};

source.getChannelContents = function(url, type, order, filters, isPlaylist) {
    const match = url.match(REGEX_AUTHOR_URL);
    if (!match) {
        return new ContentPager([], false);
    }
    
    const authorId = match[1];
    
    // Get author's audiobooks
    const booksUrl = LIBRIVOX_AUDIOBOOKS_API + "?author=" + encodeURIComponent(authorId) + "&format=json&extended=1";
    const data = makeGetRequest(booksUrl, { throwOnError: false });
    
    if (!data) {
        return new ContentPager([], false);
    }
    
    const audiobooks = data.books || [];
    const results = audiobooks
        .map(book => audiobookToPlatformVideo(book))
        .filter(Boolean);
    
    return new ContentPager(results, false);
};

// Content details
source.isContentDetailsUrl = function(url) {
    return REGEX_AUDIOBOOK_URL.test(url);
};

source.getContentDetails = function(url) {
    // Extract audiobook ID from URL
    const match = url.match(/\/([a-z0-9-]+)-?$/i);
    if (!match) {
        throw new ScriptException("Invalid audiobook URL");
    }
    
    // For Librivox, we need to search by title to get the ID
    const title = match[1].replace(/-/g, " ");
    const searchUrl = LIBRIVOX_AUDIOBOOKS_API + "?title=" + encodeURIComponent(title) + "&format=json&extended=1";
    
    const data = makeGetRequest(searchUrl, { throwOnError: false });
    
    if (!data || !data.books || data.books.length === 0) {
        throw new ScriptException("Audiobook not found");
    }
    
    const book = data.books[0];
    
    // Get tracks for this audiobook
    const tracksUrl = API_GET_TRACKS_URL_TEMPLATE.replace("{project_id}", book.id.toString());
    const tracksData = makeGetRequest(tracksUrl, { throwOnError: false });
    
    const tracks = tracksData?.sections || [];
    
    // Build description
    let description = book.description || "";
    description += "<br><br><strong>Title:</strong> " + book.title;
    description += "<br><strong>Author:</strong> " + (book.authors?.map(a => a.first_name + " " + a.last_name).join(", ") || "Unknown");
    description += "<br><strong>Language:</strong> " + (book.language || "English");
    description += "<br><strong>Total Time:</strong> " + (book.totaltime || "Unknown");
    description += "<br><strong>Chapters:</strong> " + (book.num_sections || tracks.length);
    
    // Create author link
    const author = book.authors?.[0];
    const authorName = author ? author.first_name + " " + author.last_name : "Unknown";
    const authorUrl = author ? "https://librivox.org/author/" + author.id : "";
    
    return new PlatformVideoDetails({
        id: new PlatformID(PLATFORM, book.id.toString(), config.id),
        name: book.title,
        thumbnails: new Thumbnails([new Thumbnail(getThumbnailUrl(book), 0)]),
        author: new PlatformAuthorLink(
            new PlatformID(PLATFORM, author?.id?.toString() || "unknown", config.id),
            authorName,
            authorUrl,
            ""
        ),
        uploadDate: parseInt(new Date().getTime() / 1000), // Use current time as fallback
        duration: parseDuration(book.totaltime),
        viewCount: -1,
        url: url,
        isLive: false,
        description: description,
        video: getAudioSource(book, tracks)
    });
};

// Playlist handling
source.isPlaylistUrl = function(url) {
    return REGEX_AUTHOR_URL.test(url);
};

source.getUserPlaylists = function() {
    return [];
};

source.getPlaylist = function(url) {
    if (REGEX_AUTHOR_URL.test(url)) {
        const channel = source.getChannel(url);
        const contents = source.getChannelContents(url);
        
        return new PlatformPlaylistDetails({
            url: url,
            id: channel.id,
            author: new PlatformAuthorLink(
                channel.id,
                channel.name,
                channel.url,
                channel.thumbnail
            ),
            name: channel.name + " - Audiobooks",
            thumbnail: channel.thumbnail,
            contents: contents
        });
    }
    
    throw new ScriptException('Invalid playlist url');
};

// Helper functions
function audiobookToPlatformVideo(book) {
    if (!book) return null;
    
    const author = book.authors?.[0];
    const authorName = author ? author.first_name + " " + author.last_name : "Unknown";
    const authorUrl = author ? "https://librivox.org/author/" + author.id : "";
    
    // Get best available thumbnail with fallback
    const thumbnailUrl = getThumbnailUrl(book);
    
    return new PlatformVideo({
        id: new PlatformID(PLATFORM, book.id.toString(), config.id),
        name: book.title,
        thumbnails: new Thumbnails([new Thumbnail(thumbnailUrl, 0)]),
        author: new PlatformAuthorLink(
            new PlatformID(PLATFORM, author?.id?.toString() || "unknown", config.id),
            authorName,
            authorUrl,
            ""
        ),
        uploadDate: parseInt(new Date().getTime() / 1000),
        duration: parseDuration(book.totaltime),
        viewCount: -1,
        url: "https://librivox.org/" + book.title.toLowerCase().replace(/\s+/g, "-"),
        isLive: false
    });
}

function getThumbnailUrl(book) {
    // Priority order for thumbnail sources
    if (book.coverart_jpg && book.coverart_jpg.trim() !== "") {
        return book.coverart_jpg;
    }
    
    if (book.url_cover_image && book.url_cover_image.trim() !== "") {
        return book.url_cover_image;
    }
    
    if (book.url_librivox && book.url_librivox.includes('archive.org')) {
        // Try to construct archive.org thumbnail from identifier
        const archiveMatch = book.url_librivox.match(/archive\.org\/details\/([^\/]+)/);
        if (archiveMatch) {
            const identifier = archiveMatch[1];
            return `https://archive.org/services/img/${identifier}`;
        }
    }
    
    // Fallback to Librivox logo
    return "https://librivox.org/images/librivox-logo.png";
}

function getAudioSource(book, tracks) {
    if (!tracks || tracks.length === 0) {
        // Fallback to zip file if no individual tracks
        return new UnMuxVideoSourceDescriptor([], [
            new AudioUrlSource({
                name: "audio/mp3",
                container: "audio/mp3",
                bitrate: 0,
                url: book.url_zip_file || "",
                duration: parseDuration(book.totaltime),
            })
        ]);
    }
    
    // Create audio sources for each chapter/track
    const audioSources = tracks.map(track =>
        new AudioUrlSource({
            name: track.title || "Chapter " + track.section_number,
            container: "audio/mp3",
            bitrate: 0,
            url: track.listen_url || "",
            duration: parseInt(track.playtime || 0)
        })
    );
    
    const descriptor = new UnMuxVideoSourceDescriptor([], audioSources);
    descriptor.isUnMuxed = true;

    return descriptor;
}

function parseDuration(timeString) {
    if (!timeString) return 0;
    
    const parts = timeString.split(':');
    if (parts.length === 3) {
        return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]);
    } else if (parts.length === 2) {
        return parseInt(parts[0]) * 60 + parseInt(parts[1]);
    }
    return 0;
}

function makeGetRequest(url, options = {}) {
    const {
        parseResponse = true,
        throwOnError = true,
        maxRetries = 3
    } = options;
    
    let remainingAttempts = maxRetries + 1;
    let lastError;
    
    while (remainingAttempts > 0) {
        try {
            const resp = http.GET(url, {}, false);
            
            if (!resp.isOk) {
                const errorMsg = `Request failed with status ${resp.code}: ${url}`;
                if (throwOnError) {
                    throw new ScriptException(errorMsg);
                } else {
                    log(errorMsg);
                    return parseResponse ? null : resp.body;
                }
            }
            
            if (parseResponse) {
                try {
                    const json = JSON.parse(resp.body);
                    return json;
                } catch (parseError) {
                    const errorMsg = `Failed to parse response as JSON: ${parseError.message}`;
                    if (throwOnError) {
                        throw new ScriptException(errorMsg);
                    } else {
                        log(errorMsg);
                        return null;
                    }
                }
            }
            
            return resp.body;
        } catch (error) {
            lastError = error;
            remainingAttempts--;
            
            if (remainingAttempts > 0) {
                log(`Request to ${url} failed, retrying... (${maxRetries - remainingAttempts + 1}/${maxRetries})`);
            } else {
                log(`Request failed after ${maxRetries + 1} attempts: ${url}`);
                if (throwOnError) {
                    throw lastError;
                } else {
                    return null;
                }
            }
        }
    }
}

source.saveState = () => {
    return JSON.stringify(state);
};

source.getUserSubscriptions = () => {
    return [];
};

log("Librivox plugin loaded");