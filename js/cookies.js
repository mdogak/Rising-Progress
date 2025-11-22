// Cookie helpers
function setCookie(name, value, days=365){ const d = new Date(); d.setTime(d.getTime() + (days*24*60*60*1000)); const v = encodeURIComponent(value); document.cookie = `${name}=${v};expires=${d.toUTCString()};path=/`; }
function getCookie(name){ const n = name + '='; const ca = document.cookie.split(';'); for(let c of ca){ while(c.charAt(0)==' ') c = c.substring(1); if(c.indexOf(n)==0) return decodeURIComponent(c.substring(n.length,c.length)); } return null; }
function delCookie(name){ document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;` }
