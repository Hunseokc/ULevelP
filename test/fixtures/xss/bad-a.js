// 틀린 예 (a): JS로 만드는 HTML에 style·on* 속성, setAttribute('style')
'use strict';
el.innerHTML = '<b style="color:red">' + esc(name) + '</b>';
el.innerHTML = '<img src="x.png" onerror="boom()">';
el.setAttribute('style', 'color:red');
