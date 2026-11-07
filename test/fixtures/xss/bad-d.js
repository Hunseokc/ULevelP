// 틀린 예 (d): href에 esc만 거친 URL, 검사 없는 대입, javascript: 주소
'use strict';
list.innerHTML = '<a href="' + esc(url) + '">' + esc(name) + '</a>';
link.href = data.url;
back.href = 'javascript:history.back()';
