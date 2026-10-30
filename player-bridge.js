// Earmode - player bridge
// YouTube's player methods exist only in the page's JavaScript world. content.js runs in the
// extension's isolated world, where #movie_player has none of them. This script runs in the page
// world and answers content.js through DOM events, which dispatch synchronously across worlds.

(function () {
    const ALLOWED_METHODS = new Set([
        'getAvailableQualityLevels',
        'getPlaybackQuality',
        'setPlaybackQualityRange',
        'setPlaybackQuality'
    ]);

    document.addEventListener('earmode:player-call', event => {
        const { method, args } = JSON.parse(event.detail);
        if (!ALLOWED_METHODS.has(method)) return;

        const player = document.getElementById('movie_player');
        if (typeof player?.[method] !== 'function') return;

        const result = player[method](...args);
        document.dispatchEvent(new CustomEvent('earmode:player-result', {
            detail: JSON.stringify({ result })
        }));
    });
})();
