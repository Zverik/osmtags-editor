window.addEventListener('load', function(e) {
    opener.authComplete(window.location.href);
    window.close();
});
