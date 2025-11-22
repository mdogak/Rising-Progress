// cookies.js
const COOKIE_KEY = 'progress_tracker_v3b';

function setCookie(name, value, days = 365) {
    const d = new Date();
    d.setTime(d.getTime() + (days*24*60*60*1000));
    document.cookie = `${name}=${encodeURIComponent(value)};expires=${d.toUTCString()};path=/`;
}

function getCookie(name) {
    const n = name + "=";
    const ca = document.cookie.split(';');
    for (let c of ca) {
        c = c.trim();
        if (c.startsWith(n)) {
            return decodeURIComponent(c.substring(n.length));
        }
    }
    return null;
}

function delCookie(name) {
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/`;
}
