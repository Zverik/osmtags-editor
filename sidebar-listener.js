chrome.webNavigation.onHistoryStateUpdated.addListener(details => {
    const url = details.url;
    if (url.indexOf('//www.openstreetmap.org/') < 0) return;
    if (url.indexOf('/node/') > 0 || url.indexOf('/way/') > 0 || url.indexOf('/relation/') > 0) {
        chrome.tabs.sendMessage(details.tabId, {type: 'osm_url', url: url});
    }
});
