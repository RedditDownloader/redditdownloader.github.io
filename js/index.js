const CORS_PROXY_URL = "https://api.allorigins.win/raw?url=";
const CHECK_DOWNLOADS_FINISHED_EVERY_MS = 100;
const MAX_POSTS_PER_REQUEST = 100;
const MIN_POSTS_PER_REQUEST = 5;
const RETRY_POSTS_FACTOR = 0.7;

const RANDOM_SUBREDDITS = [
    "funny",
    "pics",
    "me_irl",
    "aww",
    "dankmemes",
    "mildlyinteresting",
    "AdviceAnimals",
    "CrappyDesign",
    "OldSchoolCool",
    "2007scape"
];

const Target = {
    SUBREDDIT: 0,
    USER: 1
};

/* User options */
let userDownload;
let targetName;
let section;
let maxPostCount;
let maxPostsPerRequest;
let nameFormat;
let prependOrderIndex;
let restrictByScore;
let restrictByScoreType;
let restrictByScoreValue;
let includeImages;
let includeGifs;
let includeVideos;
let includeOthers;
let includeNonReddit;
let includeAsLink;
let includeNsfw;

let checkFinishedInterval;
let downloadRequests = new Set();
let downloadedCount;
let toDownloadCount;
let postCount;
let downloadedBytes;
let zip;

$(document).ready(function() {
    setRandomNamePlaceholder();

    setupSemanticUI();
    setupFilters();
    setupForm();
    setupButtons();
});

function setupSemanticUI() {
    $(".ui.menu .item").tab();
    $(".ui.checkbox").checkbox();
    $("select.dropdown").dropdown();
    $(".message .close").click(function() {
        $(this).closest(".message").transition("fade");
    });
    $(".ui.buttons .button").click(function() {
        $(this).addClass("active").siblings().removeClass("active");
    });
    // https://stackoverflow.com/a/30949767/4313694
    $("button").on("mousedown", 
        function(event) {
            event.preventDefault();
        }
    );
}

function setRandomNamePlaceholder() {
    $("#targetNameInput").attr("placeholder", 
        RANDOM_SUBREDDITS[Math.floor(Math.random() * RANDOM_SUBREDDITS.length)]);
}

function setupFilters() {
    $("#restrictByScoreInput").parent().checkbox({
        onChange: function() {
            if (this.checked) {
                $("#restrictByScoreTypeInput").parent().removeClass("disabled");
            } else {
                $("#restrictByScoreTypeInput").parent().addClass("disabled");
            }
            $("#restrictByScoreValueInput").prop("disabled", !this.checked);
        }
    });
}

function setupForm() {
    /* Make sure one or more of include images, animated images, videos or others are checked */
    $.fn.form.settings.rules.includeAny = function(value) {
        return $("#includeImagesInput").parent().checkbox("is checked")
            || $("#includeGifsInput").parent().checkbox("is checked")
            || $("#includeVideosInput").parent().checkbox("is checked")
            || $("#includeOthersInput").parent().checkbox("is checked");
    };

    $(".ui.form")
        .form({
            fields: {
                targetNameInput : "empty",
                downloadAmountInput : "integer[0..]",
                restrictByScoreValueInput : "integer[0..]",
                includeImagesInput : "includeAny",
                includeGifsInput : "includeAny",
                includeVideosInput : "includeAny",
                includeOthersInput : "includeAny"
            }
        })
        .on("change", "#includeImagesInput,#includeGifsInput,#includeVideosInput,#includeOthersInput", function(e) {
            /* 
                Removes the red text from include images/include 
                animated images when one of them have been pressed.
            */
            $(".ui.form").form("validate form");
        });
}

function setupButtons() {
    $("#subredditOrUserButtons .button").click(function() {
        const target = $(this).data("target");
        const isUserTarget = target == Target.USER;
        const isSubredditTarget = target == Target.SUBREDDIT;

        const targetNameLabel = isUserTarget ? "User Name" : "Subreddit Name";
        $("label[for=targetNameInput]").text(targetNameLabel);
        let sectionInputField = $("#sectionInput").parents(".field").first();
        sectionInputField.prop("hidden", isUserTarget);
        if (isUserTarget) {
            sectionInputField.parent().removeClass("two fields");
        } else {
            sectionInputField.parent().addClass("two fields");
        }
        $("#searchFilterInput").parent().prop("hidden", isUserTarget);

        if (isSubredditTarget) {
            setRandomNamePlaceholder();
        }

        $("#targetNameInput").focus();
        $("#targetNameInput").select();
    });
    $("#downloadButton").click(function() {
        $("#unknownNameErrorBox").hide();
        $("#noImagesFoundWarningBox").hide();
        $("#processingInfoBox").hide();

        if (!$(".ui.form").form("validate form")) {
            return;
        }
    
        /* Reset states */
        $(".ui.form").addClass("loading");
        $("#downloadingInfoBox").show();
        $("#downloadingInfoBox").get(0).scrollIntoView({ behavior: "smooth" });
        downloadRequests.clear();
        downloadedCount = 0;
        toDownloadCount = 0;
        postCount = 0;
        downloadedBytes = 0;
        zip = new JSZip();

        /* Read user options */
        userDownload = $("#subredditOrUserButtons .active[data-target='" + Target.USER + "']").length > 0;
        targetName = $("#targetNameInput").val();
        section = $("#sectionInput").val();
        sectionTimespan = ""; // Set further down if section contains a timespan (eg. section is "top-week")
        searchFilter = $("#searchFilterInput").val();
        nameFormat = $("#nameFormatInput").val();
        maxPostCount = $("#downloadAmountInput").val();
        prependOrderIndex = $("#prependOrderIndexInput").parent().checkbox("is checked");
        restrictByScore = $("#restrictByScoreInput").parent().checkbox("is checked");
        restrictByScoreType = $("#restrictByScoreTypeInput").val();
        restrictByScoreValue = $("#restrictByScoreValueInput").val();
        includeImages = $("#includeImagesInput").parent().checkbox("is checked");
        includeGifs = $("#includeGifsInput").parent().checkbox("is checked");
        includeVideos = $("#includeVideosInput").parent().checkbox("is checked");
        includeOthers = $("#includeOthersInput").parent().checkbox("is checked");
        includeNonReddit = $("#includeNonRedditInput").parent().checkbox("is checked");
        includeAsLink = $("#includeAsLinkInput").parent().checkbox("is checked");
        includeNsfw = $("#includeNsfwInput").parent().checkbox("is checked");

        if (userDownload) {
            /* Handle the user entering /user/ or user/ before the user name */
            if (targetName.startsWith("/user/")) {
                targetName = targetName.substring(3);
            } else if (targetName.startsWith("user/")) {
                targetName = targetName.substring(2);
            }
        } else {
            /* Handle the user entering /r/ or r/ before the sub name */
            if (targetName.startsWith("/r/")) {
                targetName = targetName.substring(3);
            } else if (targetName.startsWith("r/")) {
                targetName = targetName.substring(2);
            }
        }

        $(".targetNameText").text(targetName);

        if (userDownload) {
            $(".downloadTypeText").text("user");
        } else {
            $(".downloadTypeText").text("subreddit");
        }
        
        if (section.includes("-")) {
            const split = section.split("-");
            section = split[0];
            sectionTimespan = split[1];
        }

        /* Find images to scrape and start downloading */
        maxPostsPerRequest = MAX_POSTS_PER_REQUEST;
        updateUI();
        download();
    });
    $("#cancelDownloadButton").click(function() {
        doneDownloading();
    });
}

function updateUI() {
    $("#downloadedCountText").text(downloadedCount);
    $("#toDownloadCountText").text(toDownloadCount);
    $("#downloadedSizeText").text(Math.ceil(downloadedBytes / 1048576.0));
}

function download(anchor) {
    if (!isDownloading()) {
        return;
    }

    /* Max MAX_POSTS_PER_REQUEST posts per request */
    let maxPostCountNow = Math.min(maxPostCount, maxPostsPerRequest);

    /* Prevent extreme amounts of requests in the case that maxPostCountNow is for example 1 */
    if (maxPostCountNow < MIN_POSTS_PER_REQUEST) {
        maxPostCountNow = MIN_POSTS_PER_REQUEST;
    }

    let url;

    if (userDownload) {
        url = "https://www.reddit.com/user/" + targetName
            + ".json?limit=" + maxPostCountNow
            + (anchor !== undefined ? "&after=" + anchor : "");
    } else if (searchFilter) {
        url = "https://www.reddit.com/r/" + targetName
            + "/search.json?q=" + searchFilter + "&restrict_sr=on&limit=" + maxPostCountNow
            + (includeNsfw ? "&include_over_18=on" : "")
            + (anchor !== undefined ? "&after=" + anchor : "");
    } else {
        url = "https://www.reddit.com/r/" + targetName
            + "/" + section + ".json?limit=" + maxPostCountNow
            + (anchor !== undefined ? "&after=" + anchor : "");
    }
    if (sectionTimespan) {
        url += "&t=" + sectionTimespan;
    }

    $.ajax({
        url: CORS_PROXY_URL + encodeURIComponent(url),
        type: "GET",
        dataType: "json",
        contentType: "application/json; charset=utf-8",
        success: downloadSucceeded,
        error: downloadFailed
    });
}

function downloadSucceeded(result, status, xhr) {
    const data = result.data;
    if (data == null) {
        console.log("Error: data missing in Reddit API response");
        $("#unknownNameErrorBox").show();
        doneDownloading();
        return;
    }

    /* Make sure we haven't been redirected to the search page = subreddit doesn't exist */
    if (!userDownload && !searchFilter && data.dist === 0 && typeof anchor === "undefined") {
        $("#unknownNameErrorBox").show();
        doneDownloading();
        return;
    }

    const children = data.children;

    for (let i = 0; i < children.length; i++) {
        const post = children[i].data;
        if (post == null) {
            console.log("Error: post data missing in Reddit API response");
            continue;
        }

        if (post.crosspost_parent_list && post.crosspost_parent_list.length > 0) {
            const originalPost = post.crosspost_parent_list[0];
            console.log("Info: post " + post.name + " is a crosspost of " + originalPost.name + ", downloading that instead");
            downloadPost(originalPost);
        } else {
            downloadPost(post);
        }

        if (postCount == maxPostCount) {
            console.log("Info: reached postCount = maxPostCount, will stop iterating over posts");
            break;
        }
    }

    if (children.length === 0 || postCount >= maxPostCount || data.after === null) {
        console.log("Info: will start waiting for pending downloads to complete now");

        checkFinishedInterval = setInterval(function() {
            if (downloadedCount === toDownloadCount) {
                doneDownloading();
            }
        }, CHECK_DOWNLOADS_FINISHED_EVERY_MS);
    } else {
        download(data.after);
    }
}

function downloadPost(post) {
    const url = post.url;

    /* Only download if there's a URL */
    if (url == null) {
        return;
    }

    /* Respect user's nsfw option */
    if (!includeNsfw && post.over_18) {
        return;
    }

    /* Don't download images that come from posts with greater/less score than inputted */
    if (restrictByScore) {
        if ((restrictByScoreType === "ge" && post.score < restrictByScoreValue)
                || (restrictByScoreType === "le" && post.score > restrictByScoreValue)) {
            return;
        } 
    }

    /* Continue if direct url is a gif and user doesn't want to download gifs */
    if (!includeGifs && isDirectGifUrl(url)) {
        return;
    }

    /* Continue if post links to a video and user doesn't want to download videos */
    if (!includeVideos && (post.is_video || isDirectVideoUrl(url))) {
        return;
    }

    /* Continue if direct url is an image and user doesn't want to download images */
    if (!includeImages && isDirectImageUrl(url)) {
        return;
    }

    /* Continue if item is from an external service and user doesn't want to download from those */
    if (!includeNonReddit && (isImgurUrl(url) || isGfycatUrl(url))) {
        return;
    }

    /* Continue if link links to Imgur and we're not including anything that you can get from Imgur */
    if (!includeGifs && !includeVideos && !includeImages && isImgurUrl(url)) {
        return;
    }

    /* Continue if link links to Gfycat and we're not including anything that you can get from Gfycat */
    if (!includeGifs && !includeVideos && isGfycatUrl(url)) {
        return;
    }

    const postIdx = postCount++;

    if (isDirectImageUrl(url) || isDirectVideoUrl(url) || isDirectGifUrl(url)) {
        /* Handle item with extension (direct link) */
        downloadDirectFile(url, post, postIdx);
    } else if (isRedditVideoUrl(url)) {
        /* Handle Reddit video link */
        downloadRedditVideo(url, post, postIdx);
    } else if (isImgurAlbumOrGalleryUrl(url)) {
        /* Handle downloading an album */
        downloadImgurAlbum(url, post, postIdx);
    } else if (isImgurSingleImageAlbumUrl(url)) {
        /* Handle downloading a single-image album */
        downloadSingleImageImgurAlbum(url, post, postIdx);
    } else if (isGfycatUrl(url)) {
        downloadGfycat(url, post, postIdx);
    } else if (includeOthers && isDirectUrl(url)) {
        /* Handle downloading direct files with non-image/video extensions */
        downloadDirectFile(url, post, postIdx);
    }
}

function isImgurUrl(url) {
    return url.startsWith("http://imgur.com/") || url.startsWith("https://imgur.com/");
}

function isGfycatUrl(url) {
    return url.startsWith("http://gfycat.com/") || url.startsWith("https://gfycat.com/");
}

function isRedditVideoUrl(url) {
    return url.startsWith("http://v.redd.it/") || url.startsWith("https://v.redd.it/");
}

function isImgurAlbumOrGalleryUrl(url) {
    return url.startsWith("http://imgur.com/a/") || url.startsWith("https://imgur.com/a/") 
        || url.startsWith("http://imgur.com/gallery/") || url.startsWith("https://imgur.com/gallery/");
}

function isImgurSingleImageAlbumUrl(url) {
    return (url.startsWith("http://imgur.com/") || url.startsWith("https://imgur.com/"))
        && !isImgurAlbumOrGalleryUrl(url);
}

function downloadDirectFile(url, post, postIdx) {
    toDownloadCount++;
    downloadUrl(url, post, postIdx);
}

function downloadRedditVideo(url, post, postIdx) {
    if (!post.media || !post.media.reddit_video || !post.media.reddit_video.fallback_url) {
        console.log("Error: v.redd.it post (" + url + ") did not have an associated media object");
        return;
    }

    const videoUrl = post.media.reddit_video.fallback_url;
    // TODO: Add the audio track to the video
    //var audioUrl = videoUrl.replace(/(\d)+\.mp4/, 'audio.mp4');

    toDownloadCount++;
    downloadUrl(videoUrl, post, postIdx);
}

function downloadImgurAlbum(url, post, postIdx) {
    toDownloadCount++;

    const imageName = getPartAfterSlash(url);

    $.ajax({
        url: "https://api.imgur.com/3/album/" + imageName,
        type: "GET",
        dataType: "json",
        contentType: "application/json; charset=utf-8",
        headers: {
            "authorization": "Client-ID 326b1cb24da9d5e"
        },
        post: post, // pass to success function
        postIdx: postIdx, // pass to success function
        success: function(result, status, xhr) {
            const data = result.data;
            if (!data) {
                console.log("Error: data missing in Imgur API response for '" + url + "'");
                toDownloadCount--;
                return;
            }
            if (!includeNsfw && data.nsfw) {
                toDownloadCount--;
                return;
            }
            const images = data.images;
            for (let i = 0; i < images.length; i++) {
                const image = images[i];
                if (!includeNsfw && image.nsfw) {
                    continue;
                }
                const url = image.link;
                if (!includeGifs && isDirectGifUrl(url)
                    || !includeVideos && isDirectVideoUrl(url)
                    || !includeImages && isDirectImageUrl(url)) {
                    continue;
                }
                toDownloadCount++;
                downloadUrl(url, this.post, this.postIdx);
            }
            toDownloadCount--; /* Important that this is done at the end */
        },
        error: function(error) {
            if (error.status !== 404) {
                doneDownloading();
                alert("Accessing the Imgur API failed!\nPlease contact the developer.\nResponse code: " 
                    + error.status + "\nResponse: " + error.responseText);
            }
            toDownloadCount--;
        }
    });
}

function getPartAfterSlash(url) {
    return /([^\/]*)[\/]*$/.exec(url)[1];
}

function downloadSingleImageImgurAlbum(url, post, postIdx) {
    toDownloadCount++;

    const imageName = getPartAfterSlash(url);

    $.ajax({
        url: "https://api.imgur.com/3/image/" + imageName,
        type: "GET",
        dataType: "json",
        contentType: "application/json; charset=utf-8",
        headers: {
            "authorization": "Client-ID 326b1cb24da9d5e"
        },
        post: post, // pass to success function
        postIdx: postIdx, // pass to success function
        success: function(result, status, xhr) {
            const data = result.data;
            if (!data) {
                console.log("Error: data missing in Imgur API response for '" + url + "'");
                toDownloadCount--;
                return;
            }
            if (!includeNsfw && data.nsfw) {
                toDownloadCount--;
                return;
            }
            const url = data.link;
            if (!includeGifs && isDirectGifUrl(url)
                || !includeVideos && isDirectVideoUrl(url)
                || !includeImages && isDirectImageUrl(url)) {
                toDownloadCount--;
                return;
            }
            downloadUrl(url, this.post, this.postIdx);
        },
        error: function(error) {
            if (error.status !== 404) {
                doneDownloading();
                alert("Accessing the Imgur API failed!\nPlease contact the developer.\nResponse code: " 
                    + error.status + "\nResponse: " + error.responseText);
            }
            toDownloadCount--;
        }
    });
}

function downloadGfycat(url, post, postIdx) {
    toDownloadCount++;

    const gfycatName = getPartAfterSlash(url);

    $.ajax({
        url: "https://api.gfycat.com/v1/gfycats/" + gfycatName,
        type: "GET",
        dataType: "json",
        contentType: "application/json; charset=utf-8",
        post: post, // pass to success function
        postIdx: postIdx, // pass to success function
        success: function(result, status, xhr) {
            const gfyItem = result.gfyItem;
            if (!gfyItem) {
                console.log("Error: gfyItem missing in Gfycat API response for '" + url + "'");
                toDownloadCount--;
                return;
            }
            if (!includeNsfw && gfyItem.nsfw) {
                toDownloadCount--;
                return;
            }
            let url;
            if (includeVideos) {
                url = gfyItem.mp4Url;
            } else if (includeGifs) {
                url = gfyItem.gifUrl;
            } else {
                toDownloadCount--;
                return;
            }
            downloadUrl(url, this.post, this.postIdx);
        },
        error: function(error) {
            if (error.status !== 404) {
                doneDownloading();
                alert("Accessing the Gfycat API failed!\nPlease contact the developer.\nResponse code: " 
                    + error.status + "\nResponse: " + error.responseText);
            }
            toDownloadCount--;
        }
    });
}

function isDirectUrl(url) {
    try {
        getFileExtension(url);
        return true;
    } catch (error) {
        return false;
    }
}

function isDirectImageUrl(url) {
    url = url.toLowerCase();
    return url.indexOf(".jpg") !== -1 || url.indexOf(".jpeg") !== -1
        || url.indexOf(".png") !== -1 || url.indexOf(".bmp") !== -1
        || url.indexOf(".svg") !== -1 || url.indexOf(".webp") !== -1
        || url.indexOf(".raw") !== -1 || url.indexOf(".tiff") !== -1
        || url.indexOf(".ico") !== -1 || url.indexOf(".heif") !== -1;
}

function isDirectVideoUrl(url) {
    url = url.toLowerCase();
    return url.indexOf(".mp4") !== -1 || url.indexOf(".mkv") !== -1
        || url.indexOf(".mov") !== -1 || url.indexOf(".avi") !== -1
        || url.indexOf(".webm") !== -1;
}

function isDirectGifUrl(url) {
    url = url.toLowerCase();
    return url.indexOf(".gif") !== -1 || url.indexOf(".gifv") !== -1;
}

function downloadUrl(url, post, postIdx) {
    console.log("Info: queueing '" + url + "' for download while downloadedCount = " + downloadedCount + " and toDownloadCount = " + toDownloadCount);
    downloadFileAsBase64(url, 
        function(data) {
            const fileName = getFileNameForPost(url, post, postIdx);
            const extension = getFileExtension(url);
            addFileToZip(fileName, extension, data, post, true);
            downloadedCount++;
            updateUI();
        },
        function() {
            console.log("Warn: failed to download '" + url + "'" + (includeAsLink ? ", will save as link" : ""));
            if (includeAsLink) {
                /* Windows URL format */
                const data = "[{000214A0-0000-0000-C000-000000000046}]\n" + 
                           "Prop3=19,11\n" + 
                           "[InternetShortcut]\n" +
                           "IDList=\n" +
                           "URL=" + url;
                const fileName = getFileNameForPost(url, post, postIdx);
                addFileToZip(fileName, ".url", data, post, false);
                downloadedCount++;
                updateUI();
            } else {
                toDownloadCount--;
            }
        }
    );
}

function downloadFileAsBase64(url, callback, errored) {
    const xhr = new XMLHttpRequest();
    xhr.onload = function() {
        downloadRequests.delete(this);

        const blob = xhr.response;
        callback(blob);
    };
    xhr.onerror = function() {
        errored();
    };
    xhr.open("GET", CORS_PROXY_URL + encodeURIComponent(url));
    xhr.responseType = "blob";
    xhr.send();

    downloadRequests.add(xhr);
}

function getFileNameForPost(url, post, postIdx) {
    let fileName = prependOrderIndex ? (postIdx.toString() + "_") : "";
    if (nameFormat === "file-name") {
        fileName += getFileName(url);
    } else if (nameFormat === "post-id") {
        fileName += post.name;
    } else {
        /* default: post-name */
        const regex = /[^\/]+(?=\/$|$)/g;
        fileName += regex.exec(post.permalink)[0];
    }
    return fileName;
}

function getFileName(url) {
    const fileNameWithExt = getFileNameWithExtension(url);
    return fileNameWithExt.substring(0, fileNameWithExt.lastIndexOf("."));
}

function getFileExtension(url) {
    const fileNameWithExt = getFileNameWithExtension(url);
    return fileNameWithExt.substring(fileNameWithExt.lastIndexOf("."));
}

function getFileNameWithExtension(url) {
    const regex = /[^/\\&\?]+\.\w{1,}(?=[\?&].*$|$)/;
    const m = regex.exec(url);
    return m[0];
}

function addFileToZip(fileName, extension, data, post, dataIsBinary) {
    /* post-id is the only file name guaranteed to be unique */
    if (nameFormat !== "post-id") {
        /* Make sure we don't overwrite a saved file */
        let oldFileName = fileName;
        let counter = 0;
        while (zip.file(oldFileName + extension)) {
            oldFileName = fileName + "_" + counter++;
        }
        fileName = oldFileName;
    }

    zip.file(fileName + extension, data, { 
        binary: dataIsBinary,
        date: new Date(post.createdUtc * 1000),
        comment: "https://reddit.com" + post.permalink
    });

    downloadedBytes += dataIsBinary ? data.size : data.length;
}

function downloadFailed(error) {
    if (error.status === 404 || error.status === 403) {
        /* If HTTP status is 404 or 403, the subreddit probably doesn't exist */
        $("#unknownNameErrorBox").show();
        doneDownloading();
    } else if (error.status == 0) {
        /* The response body is likely too large for the CORS proxy, retry with fewer posts */
        maxPostsPerRequest = Math.ceil(maxPostsPerRequest * RETRY_POSTS_FACTOR);
        if (maxPostsPerRequest >= MIN_POSTS_PER_REQUEST) {
            download(anchor);
        } else {
            alert("Retried retrieval of Reddit posts too many times, are you connected to the Internet?");
            doneDownloading();
        }
    } else if (error.status !== 200) {
        /* Notify user when a non-handled status code is received */
        alert("Unknown error " + JSON.stringify(error) + " received from lookup request.\nPlease contact the developer.");
        doneDownloading();
    }
}

function doneDownloading() {
    // only run the "done" code if we're downloading
    if (!isDownloading()) {
        return;
    }

    $("#downloadingInfoBox").hide();

    for (const xhr in downloadRequests) {
        xhr.abort();
    }

    clearInterval(checkFinishedInterval);

    if (downloadedCount > 0) {
        $("#zippingProgressText").text("0");
        $("#zippingFileNameText").text("N/A");
        $("#processingInfoBox").show();

        zip.generateAsync({ 
            type: "blob",
            comment: "Downloaded using https://redditdownloader.github.io",
            compression: "DEFLATE",
            compressionOptions: {
                level: 9
            }
        }, function updateCallback(metadata) {
            $("#zippingProgressText").text(Math.floor(metadata.percent));
            if (metadata.currentFile) {
                $("#zippingFileNameText").text(metadata.currentFile);
            }
        }).then(function(content) {
            saveAs(content, targetName + "_" + section + ".zip");
            $("#processingInfoBox").hide();
            $(".ui.form").removeClass("loading");
        });
    } else {
        /* Only show the "no images found" warning if the subreddit exists */
        if (!$("#unknownNameErrorBox").is(":visible")) {
            $("#noImagesFoundWarningBox").show();
        }
        $(".ui.form").removeClass("loading");
    }
}

function isDownloading() {
    return $(".ui.form").hasClass("loading");
}
