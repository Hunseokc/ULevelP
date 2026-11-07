// 틀린 예 (e): 문자열을 코드로 실행
'use strict';
setTimeout('tick()', 100);
eval(code);
const f = new Function('a', 'return a');
