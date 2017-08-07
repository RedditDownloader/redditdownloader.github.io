var CORS_PROXY_URL = "https://cors-anywhere.herokuapp.com/";
var CHECK_DOWNLOADS_FINISHED_EVERY_MS = 100;

/* User options */
var subName;
var section;
var includeNsfw;
var includeImages;
var includeGifs;

var checkFinishedInterval;
var downloadRequests = new Set();
var downloadedCount;
var toDownloadCount;
var zip;

$(document).ready(function() {
    /* 
        Puts a random subreddit as sub name inputbox placeholder,
        list taken from https://www.reddit.com/reddits 
    */
    var subreddits = [
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
    $("#subNameInput").attr("placeholder", 
        subreddits[Math.floor(Math.random() * subreddits.length)]);

    $('.ui.checkbox').checkbox();
    $('select.dropdown').dropdown();
    $('.ui.form').form({
        fields: {
            subNameInput : 'empty',
            imageAmountInput : 'integer[0..]'
        }
    });
});

$("#downloadButton").click(function() {
    if ($('.ui.form').form('validate form')) {
        /* Reset states */
        $('.ui.form').addClass("loading");
        $("#unknownSubredditErrorBox").hide();
        $("#downloadingInfoBox").show();
        downloadRequests.clear();
        downloadedCount = 0;
        toDownloadCount = 0;
        zip = new JSZip();
        updateUI();

        /* Read user options */
        subName = $("#subNameInput").val();
        section = $("#sectionInput").val();
        includeNsfw = $("#includeNsfwInput").is(':checked');
        includeImages = $("#includeImagesInput").is(':checked');
        includeGifs = $("#includeGifsInput").is(':checked');

        /* Handle the user entering /r/ or r/ before the sub name */
        if (subName.startsWith("/r/")) {
            subName = subName.substring(3);
        } else if (subName.startsWith("r/")) {
            subName = subName.substring(2);
        }

        if (!includeImages && !includeGifs) {
            $("#includeImagesInput").prop("checked", true);
            includeImages = true;
        }

        /* Find images to scrape and start downloading */
        var maxImageCount = $("#imageAmountInput").val();
        download(maxImageCount);
    }
});

function updateUI() {
    $("#downloadedCountText").text(downloadedCount);
    $("#toDownloadCountText").text(toDownloadCount);
}

function download(maxImageCount, anchor) {
    /* Max 100 posts per request */
    var maxImageCountNow = Math.min(maxImageCount, 100);

    /* Prevent extreme amounts of requests in the case that maxImageCountNow is for example 1 */
    if (maxImageCountNow < 50) {
        maxImageCountNow = 50;
    }

    $.ajax({
        url: CORS_PROXY_URL 
            + "https://www.reddit.com/r/" + subName 
            + "/" + section + ".json?limit=" + maxImageCountNow 
            + (anchor !== undefined ? "&after=" + anchor : ""),
        type: "GET",
        dataType: "json",
        contentType: "application/json; charset=utf-8",
        success: function(result, status, xhr) {
            /* Check if we have been redirected to the search page = subreddit doesn't exist */
            if (xhr.getResponseHeader("X-Final-Url").indexOf(section + ".json") !== -1) {
                var children = result.data.children;

                var downloadedCountNow = 0;

                if (children.length > 0) {
                    for (var i = 0; i < children.length; i++) {
                        var post = children[i].data;

                        /* Only download if there's a thumbnail */
                        if (post.thumbnail_width !== null) {
                            /* Respect user's nsfw option */
                            if (includeNsfw || !post.over_18) {
                                /* Check if there are any images, there should be, but let's make sure */
                                if (post.preview !== undefined && post.preview.images.length > 0) {
                                    var url = post.preview.images[0].source.url;

                                    if (isUrlFileFormatAccepted(url)) {
                                        /* Force https */
                                        if (url.startsWith("http:")) {
                                            url = url.replace("http:", "https:");
                                        }

                                        toDownloadCount++;
                                        downloadedCountNow++;
                                        updateUI();

                                        downloadImageAsBase64(url, function(url, data) {
                                            zip.file(url.replace(/(.+\/)/, "").replace(/(\?.+)/, ""), data, { base64: true });
                                            downloadedCount++;
                                            updateUI();
                                        });

                                        if (downloadedCountNow == maxImageCount) {
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                maxImageCount -= downloadedCountNow;

                if (children.length === 0 || maxImageCount === 0) {
                    checkFinishedInterval = setInterval(function() {
                        if (downloadedCount == toDownloadCount) {
                            doneDownloading();
                        }
                    }, CHECK_DOWNLOADS_FINISHED_EVERY_MS);
                } else {
                    if (result.data.after !== null) {
                        download(maxImageCount, result.data.after);
                    } else {
                        /* If there are no more posts, quit */
                        doneDownloading();
                    }
                }
            } else {
                $("#unknownSubredditErrorBox").show();
                $("#subNameText").text(subName);
                doneDownloading();
            }
        },
        error: function(error) {
            if (error.status === 404 || error.status === 403) {
                /* If HTTP status is 404 or 403, the subreddit probably doesn't exist */
                $("#unknownSubredditErrorBox").show();
                $("#subNameText").text(subName);
            } else if (error.status !== 200) {
                /* Notify user when a non-handled status code is received */
                alert("Unknown status code " + error.status + " received from lookup request.\nPlease contact the developer.");
            }
            doneDownloading();
        }
    });
}

function isUrlFileFormatAccepted(url) {
    return (includeImages && (url.indexOf(".jpg?") !== -1 || url.indexOf(".png?") !== -1))
        || (includeGifs && (url.indexOf(".gif?") !== -1 || url.indexOf(".gifv?") !== -1));
}

function doneDownloading() {
    for (var xhr in downloadRequests) {
        xhr.abort();
    }

    clearInterval(checkFinishedInterval);

    if (downloadedCount > 0) {
        zip.generateAsync({ type:"blob" })
            .then(function(content) {
                saveAs(content, subName + "_" + section + ".zip");
            });
    }

    $('.ui.form').removeClass("loading");
    $("#downloadingInfoBox").hide();
}

function downloadImageAsBase64(url, callback) {
    var xhr = new XMLHttpRequest();
    xhr.onload = function() {
        downloadRequests.delete(this);

        var reader = new FileReader();
        reader.onloadend = function() {
            callback(url, reader.result.split(',').pop());
        }
        reader.readAsDataURL(xhr.response);
    };
    xhr.open('GET', CORS_PROXY_URL + url);
    xhr.responseType = 'blob';
    xhr.send();

    downloadRequests.add(xhr);
}

// https://stackoverflow.com/a/30949767/4313694
$('button').on('mousedown', 
    function(event) {
        event.preventDefault();
    }
);
