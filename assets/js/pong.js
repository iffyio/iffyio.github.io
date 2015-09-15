// This object will hold all exports.
var Haste = {};

/* Thunk
   Creates a thunk representing the given closure.
   If the non-updatable flag is undefined, the thunk is updatable.
*/
function T(f, nu) {
    this.f = f;
    if(nu === undefined) {
        this.x = __updatable;
    }
}

function F(f) {
    this.f = f;
}

// Special object used for blackholing.
var __blackhole = {};

// Used to indicate that an object is updatable.
var __updatable = {};

/* Apply
   Applies the function f to the arguments args. If the application is under-
   saturated, a closure is returned, awaiting further arguments. If it is over-
   saturated, the function is fully applied, and the result (assumed to be a
   function) is then applied to the remaining arguments.
*/
function A(f, args) {
    if(f instanceof T) {
        f = E(f);
    }
    // Closure does some funny stuff with functions that occasionally
    // results in non-functions getting applied, so we have to deal with
    // it.
    if(!(f instanceof Function)) {
        f = B(f);
        if(!(f instanceof Function)) {
            return f;
        }
    }

    if(f.arity === undefined) {
        f.arity = f.length;
    }
    if(args.length === f.arity) {
        switch(f.arity) {
            case 0:  return f();
            case 1:  return f(args[0]);
            default: return f.apply(null, args);
        }
    } else if(args.length > f.arity) {
        switch(f.arity) {
            case 0:  return f();
            case 1:  return A(f(args.shift()), args);
            default: return A(f.apply(null, args.splice(0, f.arity)), args);
        }
    } else {
        var g = function() {
            return A(f, args.concat(Array.prototype.slice.call(arguments)));
        };
        g.arity = f.arity - args.length;
        return g;
    }
}

/* Eval
   Evaluate the given thunk t into head normal form.
   If the "thunk" we get isn't actually a thunk, just return it.
*/
function E(t) {
    if(t instanceof T) {
        if(t.f !== __blackhole) {
            var f = t.f;
            t.f = __blackhole;
            if(t.x === __updatable) {
                t.x = f();
            } else {
                return f();
            }
        }
        return t.x;
    } else {
        return t;
    }
}

/* Bounce
   Bounce on a trampoline for as long as we get a function back.
*/
function B(f) {
    while(f instanceof F) {
        var fun = f.f;
        f.f = __blackhole;
        f = fun();
    }
    return f;
}

// Export Haste, A, B and E. Haste because we need to preserve exports, A, B
// and E because they're handy for Haste.Foreign.
if(!window) {
    var window = {};
}
window['Haste'] = Haste;
window['A'] = A;
window['E'] = E;
window['B'] = B;


/* Throw an error.
   We need to be able to use throw as an exception so we wrap it in a function.
*/
function die(err) {
    throw err;
}

function quot(a, b) {
    return (a-a%b)/b;
}

function quotRemI(a, b) {
    return [0, (a-a%b)/b, a%b];
}

// 32 bit integer multiplication, with correct overflow behavior
// note that |0 or >>>0 needs to be applied to the result, for int and word
// respectively.
if(Math.imul) {
    var imul = Math.imul;
} else {
    var imul = function(a, b) {
        // ignore high a * high a as the result will always be truncated
        var lows = (a & 0xffff) * (b & 0xffff); // low a * low b
        var aB = (a & 0xffff) * (b & 0xffff0000); // low a * high b
        var bA = (a & 0xffff0000) * (b & 0xffff); // low b * high a
        return lows + aB + bA; // sum will not exceed 52 bits, so it's safe
    }
}

function addC(a, b) {
    var x = a+b;
    return [0, x & 0xffffffff, x > 0x7fffffff];
}

function subC(a, b) {
    var x = a-b;
    return [0, x & 0xffffffff, x < -2147483648];
}

function sinh (arg) {
    return (Math.exp(arg) - Math.exp(-arg)) / 2;
}

function tanh (arg) {
    return (Math.exp(arg) - Math.exp(-arg)) / (Math.exp(arg) + Math.exp(-arg));
}

function cosh (arg) {
    return (Math.exp(arg) + Math.exp(-arg)) / 2;
}

// Scratch space for byte arrays.
var rts_scratchBuf = new ArrayBuffer(8);
var rts_scratchW32 = new Uint32Array(rts_scratchBuf);
var rts_scratchFloat = new Float32Array(rts_scratchBuf);
var rts_scratchDouble = new Float64Array(rts_scratchBuf);

function decodeFloat(x) {
    rts_scratchFloat[0] = x;
    var sign = x < 0 ? -1 : 1;
    var exp = ((rts_scratchW32[0] >> 23) & 0xff) - 150;
    var man = rts_scratchW32[0] & 0x7fffff;
    if(exp === 0) {
        ++exp;
    } else {
        man |= (1 << 23);
    }
    return [0, sign*man, exp];
}

function decodeDouble(x) {
    rts_scratchDouble[0] = x;
    var sign = x < 0 ? -1 : 1;
    var manHigh = rts_scratchW32[1] & 0xfffff;
    var manLow = rts_scratchW32[0];
    var exp = ((rts_scratchW32[1] >> 20) & 0x7ff) - 1075;
    if(exp === 0) {
        ++exp;
    } else {
        manHigh |= (1 << 20);
    }
    return [0, sign, manHigh, manLow, exp];
}

function isFloatFinite(x) {
    return isFinite(x);
}

function isDoubleFinite(x) {
    return isFinite(x);
}

function err(str) {
    die(toJSStr(str));
}

/* unpackCString#
   NOTE: update constructor tags if the code generator starts munging them.
*/
function unCStr(str) {return unAppCStr(str, [0]);}

function unFoldrCStr(str, f, z) {
    var acc = z;
    for(var i = str.length-1; i >= 0; --i) {
        acc = B(A(f, [[0, str.charCodeAt(i)], acc]));
    }
    return acc;
}

function unAppCStr(str, chrs) {
    var i = arguments[2] ? arguments[2] : 0;
    if(i >= str.length) {
        return E(chrs);
    } else {
        return [1,[0,str.charCodeAt(i)],new T(function() {
            return unAppCStr(str,chrs,i+1);
        })];
    }
}

function charCodeAt(str, i) {return str.charCodeAt(i);}

function fromJSStr(str) {
    return unCStr(E(str));
}

function toJSStr(hsstr) {
    var s = '';
    for(var str = E(hsstr); str[0] == 1; str = E(str[2])) {
        s += String.fromCharCode(E(str[1])[1]);
    }
    return s;
}

// newMutVar
function nMV(val) {
    return ({x: val});
}

// readMutVar
function rMV(mv) {
    return mv.x;
}

// writeMutVar
function wMV(mv, val) {
    mv.x = val;
}

// atomicModifyMutVar
function mMV(mv, f) {
    var x = B(A(f, [mv.x]));
    mv.x = x[1];
    return x[2];
}

function localeEncoding() {
    var le = newByteArr(5);
    le['v']['i8'][0] = 'U'.charCodeAt(0);
    le['v']['i8'][1] = 'T'.charCodeAt(0);
    le['v']['i8'][2] = 'F'.charCodeAt(0);
    le['v']['i8'][3] = '-'.charCodeAt(0);
    le['v']['i8'][4] = '8'.charCodeAt(0);
    return le;
}

var isDoubleNaN = isNaN;
var isFloatNaN = isNaN;

function isDoubleInfinite(d) {
    return (d === Infinity);
}
var isFloatInfinite = isDoubleInfinite;

function isDoubleNegativeZero(x) {
    return (x===0 && (1/x)===-Infinity);
}
var isFloatNegativeZero = isDoubleNegativeZero;

function strEq(a, b) {
    return a == b;
}

function strOrd(a, b) {
    if(a < b) {
        return [0];
    } else if(a == b) {
        return [1];
    }
    return [2];
}

function jsCatch(act, handler) {
    try {
        return B(A(act,[0]));
    } catch(e) {
        return B(A(handler,[e, 0]));
    }
}

/* Haste represents constructors internally using 1 for the first constructor,
   2 for the second, etc.
   However, dataToTag should use 0, 1, 2, etc. Also, booleans might be unboxed.
 */
function dataToTag(x) {
    if(x instanceof Array) {
        return x[0];
    } else {
        return x;
    }
}

function __word_encodeDouble(d, e) {
    return d * Math.pow(2,e);
}

var __word_encodeFloat = __word_encodeDouble;
var jsRound = Math.round;
var jsTrunc = Math.trunc ? Math.trunc : function(x) {
    return x < 0 ? Math.ceil(x) : Math.floor(x);
};
function jsRoundW(n) {
    return Math.abs(jsTrunc(n));
}
var realWorld = undefined;
if(typeof _ == 'undefined') {
    var _ = undefined;
}

function popCnt(i) {
    i = i - ((i >> 1) & 0x55555555);
    i = (i & 0x33333333) + ((i >> 2) & 0x33333333);
    return (((i + (i >> 4)) & 0x0F0F0F0F) * 0x01010101) >> 24;
}

function jsAlert(val) {
    if(typeof alert != 'undefined') {
        alert(val);
    } else {
        print(val);
    }
}

function jsLog(val) {
    console.log(val);
}

function jsPrompt(str) {
    var val;
    if(typeof prompt != 'undefined') {
        val = prompt(str);
    } else {
        print(str);
        val = readline();
    }
    return val == undefined ? '' : val.toString();
}

function jsEval(str) {
    var x = eval(str);
    return x == undefined ? '' : x.toString();
}

function isNull(obj) {
    return obj === null;
}

function jsRead(str) {
    return Number(str);
}

function jsShowI(val) {return val.toString();}
function jsShow(val) {
    var ret = val.toString();
    return val == Math.round(val) ? ret + '.0' : ret;
}

function jsGetMouseCoords(e) {
    var posx = 0;
    var posy = 0;
    if (!e) var e = window.event;
    if (e.pageX || e.pageY) 	{
	posx = e.pageX;
	posy = e.pageY;
    }
    else if (e.clientX || e.clientY) 	{
	posx = e.clientX + document.body.scrollLeft
	    + document.documentElement.scrollLeft;
	posy = e.clientY + document.body.scrollTop
	    + document.documentElement.scrollTop;
    }
    return [posx - (e.currentTarget.offsetLeft || 0),
	    posy - (e.currentTarget.offsetTop || 0)];
}

function jsSetCB(elem, evt, cb) {
    // Count return press in single line text box as a change event.
    if(evt == 'change' && elem.type.toLowerCase() == 'text') {
        setCB(elem, 'keyup', function(k) {
            if(k == '\n'.charCodeAt(0)) {
                B(A(cb,[[0,k.keyCode],0]));
            }
        });
    }

    var fun;
    switch(evt) {
    case 'click':
    case 'dblclick':
    case 'mouseup':
    case 'mousedown':
        fun = function(x) {
            var mpos = jsGetMouseCoords(x);
            var mx = [0,mpos[0]];
            var my = [0,mpos[1]];
            B(A(cb,[[0,x.button],[0,mx,my],0]));
        };
        break;
    case 'mousemove':
    case 'mouseover':
        fun = function(x) {
            var mpos = jsGetMouseCoords(x);
            var mx = [0,mpos[0]];
            var my = [0,mpos[1]];
            B(A(cb,[[0,mx,my],0]));
        };
        break;
    case 'keypress':
    case 'keyup':
    case 'keydown':
        fun = function(x) {B(A(cb,[[0,x.keyCode],0]));};
        break;
    case 'wheel':
        fun = function(x) {
            var mpos = jsGetMouseCoords(x);
            var mx = [0,mpos[0]];
            var my = [0,mpos[1]];
            var mdx = [0,x.deltaX];
            var mdy = [0,x.deltaY];
            var mdz = [0,x.deltaZ];
            B(A(cb,[[0,mx,my],[0,mdx,mdy,mdz],0]));
        };
        break;
    default:
        fun = function() {B(A(cb,[0]));};
        break;
    }
    return setCB(elem, evt, fun);
}

function setCB(elem, evt, cb) {
    if(elem.addEventListener) {
        elem.addEventListener(evt, cb, false);
        return true;
    } else if(elem.attachEvent) {
        elem.attachEvent('on'+evt, cb);
        return true;
    }
    return false;
}

function jsSetTimeout(msecs, cb) {
    window.setTimeout(function() {B(A(cb,[0]));}, msecs);
}

function jsGet(elem, prop) {
    return elem[prop].toString();
}

function jsSet(elem, prop, val) {
    elem[prop] = val;
}

function jsGetAttr(elem, prop) {
    if(elem.hasAttribute(prop)) {
        return elem.getAttribute(prop).toString();
    } else {
        return "";
    }
}

function jsSetAttr(elem, prop, val) {
    elem.setAttribute(prop, val);
}

function jsGetStyle(elem, prop) {
    return elem.style[prop].toString();
}

function jsSetStyle(elem, prop, val) {
    elem.style[prop] = val;
}

function jsKillChild(child, parent) {
    parent.removeChild(child);
}

function jsClearChildren(elem) {
    while(elem.hasChildNodes()){
        elem.removeChild(elem.lastChild);
    }
}

function jsFind(elem) {
    var e = document.getElementById(elem)
    if(e) {
        return [1,[0,e]];
    }
    return [0];
}

function jsElemsByClassName(cls) {
    var es = document.getElementsByClassName(cls);
    var els = [0];

    for (var i = es.length-1; i >= 0; --i) {
        els = [1, [0, es[i]], els];
    }
    return els;
}

function jsQuerySelectorAll(elem, query) {
    var els = [0], nl;

    if (!elem || typeof elem.querySelectorAll !== 'function') {
        return els;
    }

    nl = elem.querySelectorAll(query);

    for (var i = nl.length-1; i >= 0; --i) {
        els = [1, [0, nl[i]], els];
    }

    return els;
}

function jsCreateElem(tag) {
    return document.createElement(tag);
}

function jsCreateTextNode(str) {
    return document.createTextNode(str);
}

function jsGetChildBefore(elem) {
    elem = elem.previousSibling;
    while(elem) {
        if(typeof elem.tagName != 'undefined') {
            return [1,[0,elem]];
        }
        elem = elem.previousSibling;
    }
    return [0];
}

function jsGetLastChild(elem) {
    var len = elem.childNodes.length;
    for(var i = len-1; i >= 0; --i) {
        if(typeof elem.childNodes[i].tagName != 'undefined') {
            return [1,[0,elem.childNodes[i]]];
        }
    }
    return [0];
}


function jsGetFirstChild(elem) {
    var len = elem.childNodes.length;
    for(var i = 0; i < len; i++) {
        if(typeof elem.childNodes[i].tagName != 'undefined') {
            return [1,[0,elem.childNodes[i]]];
        }
    }
    return [0];
}


function jsGetChildren(elem) {
    var children = [0];
    var len = elem.childNodes.length;
    for(var i = len-1; i >= 0; --i) {
        if(typeof elem.childNodes[i].tagName != 'undefined') {
            children = [1, [0,elem.childNodes[i]], children];
        }
    }
    return children;
}

function jsSetChildren(elem, children) {
    children = E(children);
    jsClearChildren(elem, 0);
    while(children[0] === 1) {
        elem.appendChild(E(E(children[1])[1]));
        children = E(children[2]);
    }
}

function jsAppendChild(child, container) {
    container.appendChild(child);
}

function jsAddChildBefore(child, container, after) {
    container.insertBefore(child, after);
}

var jsRand = Math.random;

// Concatenate a Haskell list of JS strings
function jsCat(strs, sep) {
    var arr = [];
    strs = E(strs);
    while(strs[0]) {
        strs = E(strs);
        arr.push(E(strs[1])[1]);
        strs = E(strs[2]);
    }
    return arr.join(sep);
}

var jsJSONParse = JSON.parse;

// JSON stringify a string
function jsStringify(str) {
    return JSON.stringify(str);
}

// Parse a JSON message into a Haste.JSON.JSON value.
// As this pokes around inside Haskell values, it'll need to be updated if:
// * Haste.JSON.JSON changes;
// * E() starts to choke on non-thunks;
// * data constructor code generation changes; or
// * Just and Nothing change tags.
function jsParseJSON(str) {
    try {
        var js = JSON.parse(str);
        var hs = toHS(js);
    } catch(_) {
        return [0];
    }
    return [1,hs];
}

function toHS(obj) {
    switch(typeof obj) {
    case 'number':
        return [0, jsRead(obj)];
    case 'string':
        return [1, obj];
    case 'boolean':
        return [2, obj]; // Booleans are special wrt constructor tags!
    case 'object':
        if(obj instanceof Array) {
            return [3, arr2lst_json(obj, 0)];
        } else if (obj == null) {
            return [5];
        } else {
            // Object type but not array - it's a dictionary.
            // The RFC doesn't say anything about the ordering of keys, but
            // considering that lots of people rely on keys being "in order" as
            // defined by "the same way someone put them in at the other end,"
            // it's probably a good idea to put some cycles into meeting their
            // misguided expectations.
            var ks = [];
            for(var k in obj) {
                ks.unshift(k);
            }
            var xs = [0];
            for(var i = 0; i < ks.length; i++) {
                xs = [1, [0, [0,ks[i]], toHS(obj[ks[i]])], xs];
            }
            return [4, xs];
        }
    }
}

function arr2lst_json(arr, elem) {
    if(elem >= arr.length) {
        return [0];
    }
    return [1, toHS(arr[elem]), new T(function() {return arr2lst_json(arr,elem+1);}),true]
}

function arr2lst(arr, elem) {
    if(elem >= arr.length) {
        return [0];
    }
    return [1, arr[elem], new T(function() {return arr2lst(arr,elem+1);})]
}
window['arr2lst'] = arr2lst;

function lst2arr(xs) {
    var arr = [];
    for(; xs[0]; xs = E(xs[2])) {
        arr.push(E(xs[1]));
    }
    return arr;
}
window['lst2arr'] = lst2arr;

function ajaxReq(method, url, async, postdata, cb) {
    var xhr = new XMLHttpRequest();
    xhr.open(method, url, async);

    if(method == "POST") {
        xhr.setRequestHeader("Content-type",
                             "application/x-www-form-urlencoded");
    }
    xhr.onreadystatechange = function() {
        if(xhr.readyState == 4) {
            if(xhr.status == 200) {
                B(A(cb,[[1,[0,xhr.responseText]],0]));
            } else {
                B(A(cb,[[0],0])); // Nothing
            }
        }
    }
    xhr.send(postdata);
}

// Create a little endian ArrayBuffer representation of something.
function toABHost(v, n, x) {
    var a = new ArrayBuffer(n);
    new window[v](a)[0] = x;
    return a;
}

function toABSwap(v, n, x) {
    var a = new ArrayBuffer(n);
    new window[v](a)[0] = x;
    var bs = new Uint8Array(a);
    for(var i = 0, j = n-1; i < j; ++i, --j) {
        var tmp = bs[i];
        bs[i] = bs[j];
        bs[j] = tmp;
    }
    return a;
}

window['toABle'] = toABHost;
window['toABbe'] = toABSwap;

// Swap byte order if host is not little endian.
var buffer = new ArrayBuffer(2);
new DataView(buffer).setInt16(0, 256, true);
if(new Int16Array(buffer)[0] !== 256) {
    window['toABle'] = toABSwap;
    window['toABbe'] = toABHost;
}

// MVar implementation.
// Since Haste isn't concurrent, takeMVar and putMVar don't block on empty
// and full MVars respectively, but terminate the program since they would
// otherwise be blocking forever.

function newMVar() {
    return ({empty: true});
}

function tryTakeMVar(mv) {
    if(mv.empty) {
        return [0, 0, undefined];
    } else {
        var val = mv.x;
        mv.empty = true;
        mv.x = null;
        return [0, 1, val];
    }
}

function takeMVar(mv) {
    if(mv.empty) {
        // TODO: real BlockedOnDeadMVar exception, perhaps?
        err("Attempted to take empty MVar!");
    }
    var val = mv.x;
    mv.empty = true;
    mv.x = null;
    return val;
}

function putMVar(mv, val) {
    if(!mv.empty) {
        // TODO: real BlockedOnDeadMVar exception, perhaps?
        err("Attempted to put full MVar!");
    }
    mv.empty = false;
    mv.x = val;
}

function tryPutMVar(mv, val) {
    if(!mv.empty) {
        return 0;
    } else {
        mv.empty = false;
        mv.x = val;
        return 1;
    }
}

function sameMVar(a, b) {
    return (a == b);
}

function isEmptyMVar(mv) {
    return mv.empty ? 1 : 0;
}

// Implementation of stable names.
// Unlike native GHC, the garbage collector isn't going to move data around
// in a way that we can detect, so each object could serve as its own stable
// name if it weren't for the fact we can't turn a JS reference into an
// integer.
// So instead, each object has a unique integer attached to it, which serves
// as its stable name.

var __next_stable_name = 1;

function makeStableName(x) {
    if(!x.stableName) {
        x.stableName = __next_stable_name;
        __next_stable_name += 1;
    }
    return x.stableName;
}

function eqStableName(x, y) {
    return (x == y) ? 1 : 0;
}

var Integer = function(bits, sign) {
  this.bits_ = [];
  this.sign_ = sign;

  var top = true;
  for (var i = bits.length - 1; i >= 0; i--) {
    var val = bits[i] | 0;
    if (!top || val != sign) {
      this.bits_[i] = val;
      top = false;
    }
  }
};

Integer.IntCache_ = {};

var I_fromInt = function(value) {
  if (-128 <= value && value < 128) {
    var cachedObj = Integer.IntCache_[value];
    if (cachedObj) {
      return cachedObj;
    }
  }

  var obj = new Integer([value | 0], value < 0 ? -1 : 0);
  if (-128 <= value && value < 128) {
    Integer.IntCache_[value] = obj;
  }
  return obj;
};

var I_fromNumber = function(value) {
  if (isNaN(value) || !isFinite(value)) {
    return Integer.ZERO;
  } else if (value < 0) {
    return I_negate(I_fromNumber(-value));
  } else {
    var bits = [];
    var pow = 1;
    for (var i = 0; value >= pow; i++) {
      bits[i] = (value / pow) | 0;
      pow *= Integer.TWO_PWR_32_DBL_;
    }
    return new Integer(bits, 0);
  }
};

var I_fromBits = function(bits) {
  var high = bits[bits.length - 1];
  return new Integer(bits, high & (1 << 31) ? -1 : 0);
};

var I_fromString = function(str, opt_radix) {
  if (str.length == 0) {
    throw Error('number format error: empty string');
  }

  var radix = opt_radix || 10;
  if (radix < 2 || 36 < radix) {
    throw Error('radix out of range: ' + radix);
  }

  if (str.charAt(0) == '-') {
    return I_negate(I_fromString(str.substring(1), radix));
  } else if (str.indexOf('-') >= 0) {
    throw Error('number format error: interior "-" character');
  }

  var radixToPower = I_fromNumber(Math.pow(radix, 8));

  var result = Integer.ZERO;
  for (var i = 0; i < str.length; i += 8) {
    var size = Math.min(8, str.length - i);
    var value = parseInt(str.substring(i, i + size), radix);
    if (size < 8) {
      var power = I_fromNumber(Math.pow(radix, size));
      result = I_add(I_mul(result, power), I_fromNumber(value));
    } else {
      result = I_mul(result, radixToPower);
      result = I_add(result, I_fromNumber(value));
    }
  }
  return result;
};


Integer.TWO_PWR_32_DBL_ = (1 << 16) * (1 << 16);
Integer.ZERO = I_fromInt(0);
Integer.ONE = I_fromInt(1);
Integer.TWO_PWR_24_ = I_fromInt(1 << 24);

var I_toInt = function(self) {
  return self.bits_.length > 0 ? self.bits_[0] : self.sign_;
};

var I_toWord = function(self) {
  return I_toInt(self) >>> 0;
};

var I_toNumber = function(self) {
  if (isNegative(self)) {
    return -I_toNumber(I_negate(self));
  } else {
    var val = 0;
    var pow = 1;
    for (var i = 0; i < self.bits_.length; i++) {
      val += I_getBitsUnsigned(self, i) * pow;
      pow *= Integer.TWO_PWR_32_DBL_;
    }
    return val;
  }
};

var I_getBits = function(self, index) {
  if (index < 0) {
    return 0;
  } else if (index < self.bits_.length) {
    return self.bits_[index];
  } else {
    return self.sign_;
  }
};

var I_getBitsUnsigned = function(self, index) {
  var val = I_getBits(self, index);
  return val >= 0 ? val : Integer.TWO_PWR_32_DBL_ + val;
};

var getSign = function(self) {
  return self.sign_;
};

var isZero = function(self) {
  if (self.sign_ != 0) {
    return false;
  }
  for (var i = 0; i < self.bits_.length; i++) {
    if (self.bits_[i] != 0) {
      return false;
    }
  }
  return true;
};

var isNegative = function(self) {
  return self.sign_ == -1;
};

var isOdd = function(self) {
  return (self.bits_.length == 0) && (self.sign_ == -1) ||
         (self.bits_.length > 0) && ((self.bits_[0] & 1) != 0);
};

var I_equals = function(self, other) {
  if (self.sign_ != other.sign_) {
    return false;
  }
  var len = Math.max(self.bits_.length, other.bits_.length);
  for (var i = 0; i < len; i++) {
    if (I_getBits(self, i) != I_getBits(other, i)) {
      return false;
    }
  }
  return true;
};

var I_notEquals = function(self, other) {
  return !I_equals(self, other);
};

var I_greaterThan = function(self, other) {
  return I_compare(self, other) > 0;
};

var I_greaterThanOrEqual = function(self, other) {
  return I_compare(self, other) >= 0;
};

var I_lessThan = function(self, other) {
  return I_compare(self, other) < 0;
};

var I_lessThanOrEqual = function(self, other) {
  return I_compare(self, other) <= 0;
};

var I_compare = function(self, other) {
  var diff = I_sub(self, other);
  if (isNegative(diff)) {
    return -1;
  } else if (isZero(diff)) {
    return 0;
  } else {
    return +1;
  }
};

var I_compareInt = function(self, other) {
  return I_compare(self, I_fromInt(other));
}

var shorten = function(self, numBits) {
  var arr_index = (numBits - 1) >> 5;
  var bit_index = (numBits - 1) % 32;
  var bits = [];
  for (var i = 0; i < arr_index; i++) {
    bits[i] = I_getBits(self, i);
  }
  var sigBits = bit_index == 31 ? 0xFFFFFFFF : (1 << (bit_index + 1)) - 1;
  var val = I_getBits(self, arr_index) & sigBits;
  if (val & (1 << bit_index)) {
    val |= 0xFFFFFFFF - sigBits;
    bits[arr_index] = val;
    return new Integer(bits, -1);
  } else {
    bits[arr_index] = val;
    return new Integer(bits, 0);
  }
};

var I_negate = function(self) {
  return I_add(not(self), Integer.ONE);
};

var I_add = function(self, other) {
  var len = Math.max(self.bits_.length, other.bits_.length);
  var arr = [];
  var carry = 0;

  for (var i = 0; i <= len; i++) {
    var a1 = I_getBits(self, i) >>> 16;
    var a0 = I_getBits(self, i) & 0xFFFF;

    var b1 = I_getBits(other, i) >>> 16;
    var b0 = I_getBits(other, i) & 0xFFFF;

    var c0 = carry + a0 + b0;
    var c1 = (c0 >>> 16) + a1 + b1;
    carry = c1 >>> 16;
    c0 &= 0xFFFF;
    c1 &= 0xFFFF;
    arr[i] = (c1 << 16) | c0;
  }
  return I_fromBits(arr);
};

var I_sub = function(self, other) {
  return I_add(self, I_negate(other));
};

var I_mul = function(self, other) {
  if (isZero(self)) {
    return Integer.ZERO;
  } else if (isZero(other)) {
    return Integer.ZERO;
  }

  if (isNegative(self)) {
    if (isNegative(other)) {
      return I_mul(I_negate(self), I_negate(other));
    } else {
      return I_negate(I_mul(I_negate(self), other));
    }
  } else if (isNegative(other)) {
    return I_negate(I_mul(self, I_negate(other)));
  }

  if (I_lessThan(self, Integer.TWO_PWR_24_) &&
      I_lessThan(other, Integer.TWO_PWR_24_)) {
    return I_fromNumber(I_toNumber(self) * I_toNumber(other));
  }

  var len = self.bits_.length + other.bits_.length;
  var arr = [];
  for (var i = 0; i < 2 * len; i++) {
    arr[i] = 0;
  }
  for (var i = 0; i < self.bits_.length; i++) {
    for (var j = 0; j < other.bits_.length; j++) {
      var a1 = I_getBits(self, i) >>> 16;
      var a0 = I_getBits(self, i) & 0xFFFF;

      var b1 = I_getBits(other, j) >>> 16;
      var b0 = I_getBits(other, j) & 0xFFFF;

      arr[2 * i + 2 * j] += a0 * b0;
      Integer.carry16_(arr, 2 * i + 2 * j);
      arr[2 * i + 2 * j + 1] += a1 * b0;
      Integer.carry16_(arr, 2 * i + 2 * j + 1);
      arr[2 * i + 2 * j + 1] += a0 * b1;
      Integer.carry16_(arr, 2 * i + 2 * j + 1);
      arr[2 * i + 2 * j + 2] += a1 * b1;
      Integer.carry16_(arr, 2 * i + 2 * j + 2);
    }
  }

  for (var i = 0; i < len; i++) {
    arr[i] = (arr[2 * i + 1] << 16) | arr[2 * i];
  }
  for (var i = len; i < 2 * len; i++) {
    arr[i] = 0;
  }
  return new Integer(arr, 0);
};

Integer.carry16_ = function(bits, index) {
  while ((bits[index] & 0xFFFF) != bits[index]) {
    bits[index + 1] += bits[index] >>> 16;
    bits[index] &= 0xFFFF;
  }
};

var I_mod = function(self, other) {
  return I_rem(I_add(other, I_rem(self, other)), other);
}

var I_div = function(self, other) {
  if(I_greaterThan(self, Integer.ZERO) != I_greaterThan(other, Integer.ZERO)) {
    if(I_rem(self, other) != Integer.ZERO) {
      return I_sub(I_quot(self, other), Integer.ONE);
    }
  }
  return I_quot(self, other);
}

var I_quotRem = function(self, other) {
  return [0, I_quot(self, other), I_rem(self, other)];
}

var I_divMod = function(self, other) {
  return [0, I_div(self, other), I_mod(self, other)];
}

var I_quot = function(self, other) {
  if (isZero(other)) {
    throw Error('division by zero');
  } else if (isZero(self)) {
    return Integer.ZERO;
  }

  if (isNegative(self)) {
    if (isNegative(other)) {
      return I_quot(I_negate(self), I_negate(other));
    } else {
      return I_negate(I_quot(I_negate(self), other));
    }
  } else if (isNegative(other)) {
    return I_negate(I_quot(self, I_negate(other)));
  }

  var res = Integer.ZERO;
  var rem = self;
  while (I_greaterThanOrEqual(rem, other)) {
    var approx = Math.max(1, Math.floor(I_toNumber(rem) / I_toNumber(other)));
    var log2 = Math.ceil(Math.log(approx) / Math.LN2);
    var delta = (log2 <= 48) ? 1 : Math.pow(2, log2 - 48);
    var approxRes = I_fromNumber(approx);
    var approxRem = I_mul(approxRes, other);
    while (isNegative(approxRem) || I_greaterThan(approxRem, rem)) {
      approx -= delta;
      approxRes = I_fromNumber(approx);
      approxRem = I_mul(approxRes, other);
    }

    if (isZero(approxRes)) {
      approxRes = Integer.ONE;
    }

    res = I_add(res, approxRes);
    rem = I_sub(rem, approxRem);
  }
  return res;
};

var I_rem = function(self, other) {
  return I_sub(self, I_mul(I_quot(self, other), other));
};

var not = function(self) {
  var len = self.bits_.length;
  var arr = [];
  for (var i = 0; i < len; i++) {
    arr[i] = ~self.bits_[i];
  }
  return new Integer(arr, ~self.sign_);
};

var I_and = function(self, other) {
  var len = Math.max(self.bits_.length, other.bits_.length);
  var arr = [];
  for (var i = 0; i < len; i++) {
    arr[i] = I_getBits(self, i) & I_getBits(other, i);
  }
  return new Integer(arr, self.sign_ & other.sign_);
};

var I_or = function(self, other) {
  var len = Math.max(self.bits_.length, other.bits_.length);
  var arr = [];
  for (var i = 0; i < len; i++) {
    arr[i] = I_getBits(self, i) | I_getBits(other, i);
  }
  return new Integer(arr, self.sign_ | other.sign_);
};

var I_xor = function(self, other) {
  var len = Math.max(self.bits_.length, other.bits_.length);
  var arr = [];
  for (var i = 0; i < len; i++) {
    arr[i] = I_getBits(self, i) ^ I_getBits(other, i);
  }
  return new Integer(arr, self.sign_ ^ other.sign_);
};

var I_shiftLeft = function(self, numBits) {
  var arr_delta = numBits >> 5;
  var bit_delta = numBits % 32;
  var len = self.bits_.length + arr_delta + (bit_delta > 0 ? 1 : 0);
  var arr = [];
  for (var i = 0; i < len; i++) {
    if (bit_delta > 0) {
      arr[i] = (I_getBits(self, i - arr_delta) << bit_delta) |
               (I_getBits(self, i - arr_delta - 1) >>> (32 - bit_delta));
    } else {
      arr[i] = I_getBits(self, i - arr_delta);
    }
  }
  return new Integer(arr, self.sign_);
};

var I_shiftRight = function(self, numBits) {
  var arr_delta = numBits >> 5;
  var bit_delta = numBits % 32;
  var len = self.bits_.length - arr_delta;
  var arr = [];
  for (var i = 0; i < len; i++) {
    if (bit_delta > 0) {
      arr[i] = (I_getBits(self, i + arr_delta) >>> bit_delta) |
               (I_getBits(self, i + arr_delta + 1) << (32 - bit_delta));
    } else {
      arr[i] = I_getBits(self, i + arr_delta);
    }
  }
  return new Integer(arr, self.sign_);
};

var I_signum = function(self) {
  var cmp = I_compare(self, Integer.ZERO);
  if(cmp > 0) {
    return Integer.ONE
  }
  if(cmp < 0) {
    return I_sub(Integer.ZERO, Integer.ONE);
  }
  return Integer.ZERO;
};

var I_abs = function(self) {
  if(I_compare(self, Integer.ZERO) < 0) {
    return I_sub(Integer.ZERO, self);
  }
  return self;
};

var I_decodeDouble = function(x) {
  var dec = decodeDouble(x);
  var mantissa = I_fromBits([dec[3], dec[2]]);
  if(dec[1] < 0) {
    mantissa = I_negate(mantissa);
  }
  return [0, dec[4], mantissa];
}

var I_toString = function(self) {
  var radix = 10;

  if (isZero(self)) {
    return '0';
  } else if (isNegative(self)) {
    return '-' + I_toString(I_negate(self));
  }

  var radixToPower = I_fromNumber(Math.pow(radix, 6));

  var rem = self;
  var result = '';
  while (true) {
    var remDiv = I_div(rem, radixToPower);
    var intval = I_toInt(I_sub(rem, I_mul(remDiv, radixToPower)));
    var digits = intval.toString();

    rem = remDiv;
    if (isZero(rem)) {
      return digits + result;
    } else {
      while (digits.length < 6) {
        digits = '0' + digits;
      }
      result = '' + digits + result;
    }
  }
};

var I_fromRat = function(a, b) {
    return I_toNumber(a) / I_toNumber(b);
}

function I_fromInt64(x) {
    return I_fromBits([x.getLowBits(), x.getHighBits()]);
}

function I_toInt64(x) {
    return Long.fromBits(I_getBits(x, 0), I_getBits(x, 1));
}

function I_fromWord64(x) {
    return x;
}

function I_toWord64(x) {
    return I_rem(I_add(__w64_max, x), __w64_max);
}

// Copyright 2009 The Closure Library Authors. All Rights Reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS-IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

var Long = function(low, high) {
  this.low_ = low | 0;
  this.high_ = high | 0;
};

Long.IntCache_ = {};

Long.fromInt = function(value) {
  if (-128 <= value && value < 128) {
    var cachedObj = Long.IntCache_[value];
    if (cachedObj) {
      return cachedObj;
    }
  }

  var obj = new Long(value | 0, value < 0 ? -1 : 0);
  if (-128 <= value && value < 128) {
    Long.IntCache_[value] = obj;
  }
  return obj;
};

Long.fromNumber = function(value) {
  if (isNaN(value) || !isFinite(value)) {
    return Long.ZERO;
  } else if (value <= -Long.TWO_PWR_63_DBL_) {
    return Long.MIN_VALUE;
  } else if (value + 1 >= Long.TWO_PWR_63_DBL_) {
    return Long.MAX_VALUE;
  } else if (value < 0) {
    return Long.fromNumber(-value).negate();
  } else {
    return new Long(
        (value % Long.TWO_PWR_32_DBL_) | 0,
        (value / Long.TWO_PWR_32_DBL_) | 0);
  }
};

Long.fromBits = function(lowBits, highBits) {
  return new Long(lowBits, highBits);
};

Long.TWO_PWR_16_DBL_ = 1 << 16;
Long.TWO_PWR_24_DBL_ = 1 << 24;
Long.TWO_PWR_32_DBL_ =
    Long.TWO_PWR_16_DBL_ * Long.TWO_PWR_16_DBL_;
Long.TWO_PWR_31_DBL_ =
    Long.TWO_PWR_32_DBL_ / 2;
Long.TWO_PWR_48_DBL_ =
    Long.TWO_PWR_32_DBL_ * Long.TWO_PWR_16_DBL_;
Long.TWO_PWR_64_DBL_ =
    Long.TWO_PWR_32_DBL_ * Long.TWO_PWR_32_DBL_;
Long.TWO_PWR_63_DBL_ =
    Long.TWO_PWR_64_DBL_ / 2;
Long.ZERO = Long.fromInt(0);
Long.ONE = Long.fromInt(1);
Long.NEG_ONE = Long.fromInt(-1);
Long.MAX_VALUE =
    Long.fromBits(0xFFFFFFFF | 0, 0x7FFFFFFF | 0);
Long.MIN_VALUE = Long.fromBits(0, 0x80000000 | 0);
Long.TWO_PWR_24_ = Long.fromInt(1 << 24);

Long.prototype.toInt = function() {
  return this.low_;
};

Long.prototype.toNumber = function() {
  return this.high_ * Long.TWO_PWR_32_DBL_ +
         this.getLowBitsUnsigned();
};

Long.prototype.getHighBits = function() {
  return this.high_;
};

Long.prototype.getLowBits = function() {
  return this.low_;
};

Long.prototype.getLowBitsUnsigned = function() {
  return (this.low_ >= 0) ?
      this.low_ : Long.TWO_PWR_32_DBL_ + this.low_;
};

Long.prototype.isZero = function() {
  return this.high_ == 0 && this.low_ == 0;
};

Long.prototype.isNegative = function() {
  return this.high_ < 0;
};

Long.prototype.isOdd = function() {
  return (this.low_ & 1) == 1;
};

Long.prototype.equals = function(other) {
  return (this.high_ == other.high_) && (this.low_ == other.low_);
};

Long.prototype.notEquals = function(other) {
  return (this.high_ != other.high_) || (this.low_ != other.low_);
};

Long.prototype.lessThan = function(other) {
  return this.compare(other) < 0;
};

Long.prototype.lessThanOrEqual = function(other) {
  return this.compare(other) <= 0;
};

Long.prototype.greaterThan = function(other) {
  return this.compare(other) > 0;
};

Long.prototype.greaterThanOrEqual = function(other) {
  return this.compare(other) >= 0;
};

Long.prototype.compare = function(other) {
  if (this.equals(other)) {
    return 0;
  }

  var thisNeg = this.isNegative();
  var otherNeg = other.isNegative();
  if (thisNeg && !otherNeg) {
    return -1;
  }
  if (!thisNeg && otherNeg) {
    return 1;
  }

  if (this.subtract(other).isNegative()) {
    return -1;
  } else {
    return 1;
  }
};

Long.prototype.negate = function() {
  if (this.equals(Long.MIN_VALUE)) {
    return Long.MIN_VALUE;
  } else {
    return this.not().add(Long.ONE);
  }
};

Long.prototype.add = function(other) {
  var a48 = this.high_ >>> 16;
  var a32 = this.high_ & 0xFFFF;
  var a16 = this.low_ >>> 16;
  var a00 = this.low_ & 0xFFFF;

  var b48 = other.high_ >>> 16;
  var b32 = other.high_ & 0xFFFF;
  var b16 = other.low_ >>> 16;
  var b00 = other.low_ & 0xFFFF;

  var c48 = 0, c32 = 0, c16 = 0, c00 = 0;
  c00 += a00 + b00;
  c16 += c00 >>> 16;
  c00 &= 0xFFFF;
  c16 += a16 + b16;
  c32 += c16 >>> 16;
  c16 &= 0xFFFF;
  c32 += a32 + b32;
  c48 += c32 >>> 16;
  c32 &= 0xFFFF;
  c48 += a48 + b48;
  c48 &= 0xFFFF;
  return Long.fromBits((c16 << 16) | c00, (c48 << 16) | c32);
};

Long.prototype.subtract = function(other) {
  return this.add(other.negate());
};

Long.prototype.multiply = function(other) {
  if (this.isZero()) {
    return Long.ZERO;
  } else if (other.isZero()) {
    return Long.ZERO;
  }

  if (this.equals(Long.MIN_VALUE)) {
    return other.isOdd() ? Long.MIN_VALUE : Long.ZERO;
  } else if (other.equals(Long.MIN_VALUE)) {
    return this.isOdd() ? Long.MIN_VALUE : Long.ZERO;
  }

  if (this.isNegative()) {
    if (other.isNegative()) {
      return this.negate().multiply(other.negate());
    } else {
      return this.negate().multiply(other).negate();
    }
  } else if (other.isNegative()) {
    return this.multiply(other.negate()).negate();
  }

  if (this.lessThan(Long.TWO_PWR_24_) &&
      other.lessThan(Long.TWO_PWR_24_)) {
    return Long.fromNumber(this.toNumber() * other.toNumber());
  }

  var a48 = this.high_ >>> 16;
  var a32 = this.high_ & 0xFFFF;
  var a16 = this.low_ >>> 16;
  var a00 = this.low_ & 0xFFFF;

  var b48 = other.high_ >>> 16;
  var b32 = other.high_ & 0xFFFF;
  var b16 = other.low_ >>> 16;
  var b00 = other.low_ & 0xFFFF;

  var c48 = 0, c32 = 0, c16 = 0, c00 = 0;
  c00 += a00 * b00;
  c16 += c00 >>> 16;
  c00 &= 0xFFFF;
  c16 += a16 * b00;
  c32 += c16 >>> 16;
  c16 &= 0xFFFF;
  c16 += a00 * b16;
  c32 += c16 >>> 16;
  c16 &= 0xFFFF;
  c32 += a32 * b00;
  c48 += c32 >>> 16;
  c32 &= 0xFFFF;
  c32 += a16 * b16;
  c48 += c32 >>> 16;
  c32 &= 0xFFFF;
  c32 += a00 * b32;
  c48 += c32 >>> 16;
  c32 &= 0xFFFF;
  c48 += a48 * b00 + a32 * b16 + a16 * b32 + a00 * b48;
  c48 &= 0xFFFF;
  return Long.fromBits((c16 << 16) | c00, (c48 << 16) | c32);
};

Long.prototype.div = function(other) {
  if (other.isZero()) {
    throw Error('division by zero');
  } else if (this.isZero()) {
    return Long.ZERO;
  }

  if (this.equals(Long.MIN_VALUE)) {
    if (other.equals(Long.ONE) ||
        other.equals(Long.NEG_ONE)) {
      return Long.MIN_VALUE;
    } else if (other.equals(Long.MIN_VALUE)) {
      return Long.ONE;
    } else {
      var halfThis = this.shiftRight(1);
      var approx = halfThis.div(other).shiftLeft(1);
      if (approx.equals(Long.ZERO)) {
        return other.isNegative() ? Long.ONE : Long.NEG_ONE;
      } else {
        var rem = this.subtract(other.multiply(approx));
        var result = approx.add(rem.div(other));
        return result;
      }
    }
  } else if (other.equals(Long.MIN_VALUE)) {
    return Long.ZERO;
  }

  if (this.isNegative()) {
    if (other.isNegative()) {
      return this.negate().div(other.negate());
    } else {
      return this.negate().div(other).negate();
    }
  } else if (other.isNegative()) {
    return this.div(other.negate()).negate();
  }

  var res = Long.ZERO;
  var rem = this;
  while (rem.greaterThanOrEqual(other)) {
    var approx = Math.max(1, Math.floor(rem.toNumber() / other.toNumber()));

    var log2 = Math.ceil(Math.log(approx) / Math.LN2);
    var delta = (log2 <= 48) ? 1 : Math.pow(2, log2 - 48);

    var approxRes = Long.fromNumber(approx);
    var approxRem = approxRes.multiply(other);
    while (approxRem.isNegative() || approxRem.greaterThan(rem)) {
      approx -= delta;
      approxRes = Long.fromNumber(approx);
      approxRem = approxRes.multiply(other);
    }

    if (approxRes.isZero()) {
      approxRes = Long.ONE;
    }

    res = res.add(approxRes);
    rem = rem.subtract(approxRem);
  }
  return res;
};

Long.prototype.modulo = function(other) {
  return this.subtract(this.div(other).multiply(other));
};

Long.prototype.not = function() {
  return Long.fromBits(~this.low_, ~this.high_);
};

Long.prototype.and = function(other) {
  return Long.fromBits(this.low_ & other.low_,
                                 this.high_ & other.high_);
};

Long.prototype.or = function(other) {
  return Long.fromBits(this.low_ | other.low_,
                                 this.high_ | other.high_);
};

Long.prototype.xor = function(other) {
  return Long.fromBits(this.low_ ^ other.low_,
                                 this.high_ ^ other.high_);
};

Long.prototype.shiftLeft = function(numBits) {
  numBits &= 63;
  if (numBits == 0) {
    return this;
  } else {
    var low = this.low_;
    if (numBits < 32) {
      var high = this.high_;
      return Long.fromBits(
          low << numBits,
          (high << numBits) | (low >>> (32 - numBits)));
    } else {
      return Long.fromBits(0, low << (numBits - 32));
    }
  }
};

Long.prototype.shiftRight = function(numBits) {
  numBits &= 63;
  if (numBits == 0) {
    return this;
  } else {
    var high = this.high_;
    if (numBits < 32) {
      var low = this.low_;
      return Long.fromBits(
          (low >>> numBits) | (high << (32 - numBits)),
          high >> numBits);
    } else {
      return Long.fromBits(
          high >> (numBits - 32),
          high >= 0 ? 0 : -1);
    }
  }
};

Long.prototype.shiftRightUnsigned = function(numBits) {
  numBits &= 63;
  if (numBits == 0) {
    return this;
  } else {
    var high = this.high_;
    if (numBits < 32) {
      var low = this.low_;
      return Long.fromBits(
          (low >>> numBits) | (high << (32 - numBits)),
          high >>> numBits);
    } else if (numBits == 32) {
      return Long.fromBits(high, 0);
    } else {
      return Long.fromBits(high >>> (numBits - 32), 0);
    }
  }
};



// Int64
function hs_eqInt64(x, y) {return x.equals(y);}
function hs_neInt64(x, y) {return !x.equals(y);}
function hs_ltInt64(x, y) {return x.compare(y) < 0;}
function hs_leInt64(x, y) {return x.compare(y) <= 0;}
function hs_gtInt64(x, y) {return x.compare(y) > 0;}
function hs_geInt64(x, y) {return x.compare(y) >= 0;}
function hs_quotInt64(x, y) {return x.div(y);}
function hs_remInt64(x, y) {return x.modulo(y);}
function hs_plusInt64(x, y) {return x.add(y);}
function hs_minusInt64(x, y) {return x.subtract(y);}
function hs_timesInt64(x, y) {return x.multiply(y);}
function hs_negateInt64(x) {return x.negate();}
function hs_uncheckedIShiftL64(x, bits) {return x.shiftLeft(bits);}
function hs_uncheckedIShiftRA64(x, bits) {return x.shiftRight(bits);}
function hs_uncheckedIShiftRL64(x, bits) {return x.shiftRightUnsigned(bits);}
function hs_intToInt64(x) {return new Long(x, 0);}
function hs_int64ToInt(x) {return x.toInt();}



// Word64
function hs_wordToWord64(x) {
    return I_fromInt(x);
}
function hs_word64ToWord(x) {
    return I_toInt(x);
}
function hs_mkWord64(low, high) {
    return I_fromBits([low, high]);
}

var hs_and64 = I_and;
var hs_or64 = I_or;
var hs_xor64 = I_xor;
var __i64_all_ones = I_fromBits([0xffffffff, 0xffffffff]);
function hs_not64(x) {
    return I_xor(x, __i64_all_ones);
}
var hs_eqWord64 = I_equals;
var hs_neWord64 = I_notEquals;
var hs_ltWord64 = I_lessThan;
var hs_leWord64 = I_lessThanOrEqual;
var hs_gtWord64 = I_greaterThan;
var hs_geWord64 = I_greaterThanOrEqual;
var hs_quotWord64 = I_quot;
var hs_remWord64 = I_rem;
var __w64_max = I_fromBits([0,0,1]);
function hs_uncheckedShiftL64(x, bits) {
    return I_rem(I_shiftLeft(x, bits), __w64_max);
}
var hs_uncheckedShiftRL64 = I_shiftRight;
function hs_int64ToWord64(x) {
    var tmp = I_add(__w64_max, I_fromBits([x.getLowBits(), x.getHighBits()]));
    return I_rem(tmp, __w64_max);
}
function hs_word64ToInt64(x) {
    return Long.fromBits(I_getBits(x, 0), I_getBits(x, 1));
}

// Joseph Myers' MD5 implementation; used under the BSD license.

function md5cycle(x, k) {
    var a = x[0], b = x[1], c = x[2], d = x[3];

    a = ff(a, b, c, d, k[0], 7, -680876936);
    d = ff(d, a, b, c, k[1], 12, -389564586);
    c = ff(c, d, a, b, k[2], 17,  606105819);
    b = ff(b, c, d, a, k[3], 22, -1044525330);
    a = ff(a, b, c, d, k[4], 7, -176418897);
    d = ff(d, a, b, c, k[5], 12,  1200080426);
    c = ff(c, d, a, b, k[6], 17, -1473231341);
    b = ff(b, c, d, a, k[7], 22, -45705983);
    a = ff(a, b, c, d, k[8], 7,  1770035416);
    d = ff(d, a, b, c, k[9], 12, -1958414417);
    c = ff(c, d, a, b, k[10], 17, -42063);
    b = ff(b, c, d, a, k[11], 22, -1990404162);
    a = ff(a, b, c, d, k[12], 7,  1804603682);
    d = ff(d, a, b, c, k[13], 12, -40341101);
    c = ff(c, d, a, b, k[14], 17, -1502002290);
    b = ff(b, c, d, a, k[15], 22,  1236535329);

    a = gg(a, b, c, d, k[1], 5, -165796510);
    d = gg(d, a, b, c, k[6], 9, -1069501632);
    c = gg(c, d, a, b, k[11], 14,  643717713);
    b = gg(b, c, d, a, k[0], 20, -373897302);
    a = gg(a, b, c, d, k[5], 5, -701558691);
    d = gg(d, a, b, c, k[10], 9,  38016083);
    c = gg(c, d, a, b, k[15], 14, -660478335);
    b = gg(b, c, d, a, k[4], 20, -405537848);
    a = gg(a, b, c, d, k[9], 5,  568446438);
    d = gg(d, a, b, c, k[14], 9, -1019803690);
    c = gg(c, d, a, b, k[3], 14, -187363961);
    b = gg(b, c, d, a, k[8], 20,  1163531501);
    a = gg(a, b, c, d, k[13], 5, -1444681467);
    d = gg(d, a, b, c, k[2], 9, -51403784);
    c = gg(c, d, a, b, k[7], 14,  1735328473);
    b = gg(b, c, d, a, k[12], 20, -1926607734);

    a = hh(a, b, c, d, k[5], 4, -378558);
    d = hh(d, a, b, c, k[8], 11, -2022574463);
    c = hh(c, d, a, b, k[11], 16,  1839030562);
    b = hh(b, c, d, a, k[14], 23, -35309556);
    a = hh(a, b, c, d, k[1], 4, -1530992060);
    d = hh(d, a, b, c, k[4], 11,  1272893353);
    c = hh(c, d, a, b, k[7], 16, -155497632);
    b = hh(b, c, d, a, k[10], 23, -1094730640);
    a = hh(a, b, c, d, k[13], 4,  681279174);
    d = hh(d, a, b, c, k[0], 11, -358537222);
    c = hh(c, d, a, b, k[3], 16, -722521979);
    b = hh(b, c, d, a, k[6], 23,  76029189);
    a = hh(a, b, c, d, k[9], 4, -640364487);
    d = hh(d, a, b, c, k[12], 11, -421815835);
    c = hh(c, d, a, b, k[15], 16,  530742520);
    b = hh(b, c, d, a, k[2], 23, -995338651);

    a = ii(a, b, c, d, k[0], 6, -198630844);
    d = ii(d, a, b, c, k[7], 10,  1126891415);
    c = ii(c, d, a, b, k[14], 15, -1416354905);
    b = ii(b, c, d, a, k[5], 21, -57434055);
    a = ii(a, b, c, d, k[12], 6,  1700485571);
    d = ii(d, a, b, c, k[3], 10, -1894986606);
    c = ii(c, d, a, b, k[10], 15, -1051523);
    b = ii(b, c, d, a, k[1], 21, -2054922799);
    a = ii(a, b, c, d, k[8], 6,  1873313359);
    d = ii(d, a, b, c, k[15], 10, -30611744);
    c = ii(c, d, a, b, k[6], 15, -1560198380);
    b = ii(b, c, d, a, k[13], 21,  1309151649);
    a = ii(a, b, c, d, k[4], 6, -145523070);
    d = ii(d, a, b, c, k[11], 10, -1120210379);
    c = ii(c, d, a, b, k[2], 15,  718787259);
    b = ii(b, c, d, a, k[9], 21, -343485551);

    x[0] = add32(a, x[0]);
    x[1] = add32(b, x[1]);
    x[2] = add32(c, x[2]);
    x[3] = add32(d, x[3]);

}

function cmn(q, a, b, x, s, t) {
    a = add32(add32(a, q), add32(x, t));
    return add32((a << s) | (a >>> (32 - s)), b);
}

function ff(a, b, c, d, x, s, t) {
    return cmn((b & c) | ((~b) & d), a, b, x, s, t);
}

function gg(a, b, c, d, x, s, t) {
    return cmn((b & d) | (c & (~d)), a, b, x, s, t);
}

function hh(a, b, c, d, x, s, t) {
    return cmn(b ^ c ^ d, a, b, x, s, t);
}

function ii(a, b, c, d, x, s, t) {
    return cmn(c ^ (b | (~d)), a, b, x, s, t);
}

function md51(s) {
    var n = s.length,
        state = [1732584193, -271733879, -1732584194, 271733878], i;
    for (i=64; i<=s.length; i+=64) {
        md5cycle(state, md5blk(s.substring(i-64, i)));
    }
    s = s.substring(i-64);
    var tail = [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0];
    for (i=0; i<s.length; i++)
        tail[i>>2] |= s.charCodeAt(i) << ((i%4) << 3);
    tail[i>>2] |= 0x80 << ((i%4) << 3);
    if (i > 55) {
        md5cycle(state, tail);
        for (i=0; i<16; i++) tail[i] = 0;
    }
    tail[14] = n*8;
    md5cycle(state, tail);
    return state;
}
window['md51'] = md51;

function md5blk(s) {
    var md5blks = [], i;
    for (i=0; i<64; i+=4) {
        md5blks[i>>2] = s.charCodeAt(i)
            + (s.charCodeAt(i+1) << 8)
            + (s.charCodeAt(i+2) << 16)
            + (s.charCodeAt(i+3) << 24);
    }
    return md5blks;
}

var hex_chr = '0123456789abcdef'.split('');

function rhex(n)
{
    var s='', j=0;
    for(; j<4; j++)
        s += hex_chr[(n >> (j * 8 + 4)) & 0x0F]
        + hex_chr[(n >> (j * 8)) & 0x0F];
    return s;
}

function hex(x) {
    for (var i=0; i<x.length; i++)
        x[i] = rhex(x[i]);
    return x.join('');
}

function md5(s) {
    return hex(md51(s));
}

function add32(a, b) {
    return (a + b) & 0xFFFFFFFF;
}

// Functions for dealing with arrays.

function newArr(n, x) {
    var arr = [];
    for(; n >= 0; --n) {
        arr.push(x);
    }
    return arr;
}

// Create all views at once; perhaps it's wasteful, but it's better than having
// to check for the right view at each read or write.
function newByteArr(n) {
    // Pad the thing to multiples of 8.
    var padding = 8 - n % 8;
    if(padding < 8) {
        n += padding;
    }
    var arr = {};
    var buffer = new ArrayBuffer(n);
    var views = {};
    views['i8']  = new Int8Array(buffer);
    views['i16'] = new Int16Array(buffer);
    views['i32'] = new Int32Array(buffer);
    views['w8']  = new Uint8Array(buffer);
    views['w16'] = new Uint16Array(buffer);
    views['w32'] = new Uint32Array(buffer);
    views['f32'] = new Float32Array(buffer);
    views['f64'] = new Float64Array(buffer);
    arr['b'] = buffer;
    arr['v'] = views;
    // ByteArray and Addr are the same thing, so keep an offset if we get
    // casted.
    arr['off'] = 0;
    return arr;
}

// An attempt at emulating pointers enough for ByteString and Text to be
// usable without patching the hell out of them.
// The general idea is that Addr# is a byte array with an associated offset.

function plusAddr(addr, off) {
    var newaddr = {};
    newaddr['off'] = addr['off'] + off;
    newaddr['b']   = addr['b'];
    newaddr['v']   = addr['v'];
    return newaddr;
}

function writeOffAddr(type, elemsize, addr, off, x) {
    addr['v'][type][addr.off/elemsize + off] = x;
}

function readOffAddr(type, elemsize, addr, off) {
    return addr['v'][type][addr.off/elemsize + off];
}

// Two addresses are equal if they point to the same buffer and have the same
// offset. For other comparisons, just use the offsets - nobody in their right
// mind would check if one pointer is less than another, completely unrelated,
// pointer and then act on that information anyway.
function addrEq(a, b) {
    if(a == b) {
        return true;
    }
    return a && b && a['b'] == b['b'] && a['off'] == b['off'];
}

function addrLT(a, b) {
    if(a) {
        return b && a['off'] < b['off'];
    } else {
        return (b != 0); 
    }
}

function addrGT(a, b) {
    if(b) {
        return a && a['off'] > b['off'];
    } else {
        return (a != 0);
    }
}

function withChar(f, charCode) {
    return f(String.fromCharCode(charCode)).charCodeAt(0);
}

function u_towlower(charCode) {
    return withChar(function(c) {return c.toLowerCase()}, charCode);
}

function u_towupper(charCode) {
    return withChar(function(c) {return c.toUpperCase()}, charCode);
}

var u_towtitle = u_towupper;

function u_iswupper(charCode) {
    var c = String.fromCharCode(charCode);
    return c == c.toUpperCase() && c != c.toLowerCase();
}

function u_iswlower(charCode) {
    var c = String.fromCharCode(charCode);
    return  c == c.toLowerCase() && c != c.toUpperCase();
}

function u_iswdigit(charCode) {
    return charCode >= 48 && charCode <= 57;
}

function u_iswcntrl(charCode) {
    return charCode <= 0x1f || charCode == 0x7f;
}

function u_iswspace(charCode) {
    var c = String.fromCharCode(charCode);
    return c.replace(/\s/g,'') != c;
}

function u_iswalpha(charCode) {
    var c = String.fromCharCode(charCode);
    return c.replace(__hs_alphare, '') != c;
}

function u_iswalnum(charCode) {
    return u_iswdigit(charCode) || u_iswalpha(charCode);
}

function u_iswprint(charCode) {
    return !u_iswcntrl(charCode);
}

function u_gencat(c) {
    throw 'u_gencat is only supported with --full-unicode.';
}

// Regex that matches any alphabetic character in any language. Horrible thing.
var __hs_alphare = /[\u0041-\u005A\u0061-\u007A\u00AA\u00B5\u00BA\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02C1\u02C6-\u02D1\u02E0-\u02E4\u02EC\u02EE\u0370-\u0374\u0376\u0377\u037A-\u037D\u0386\u0388-\u038A\u038C\u038E-\u03A1\u03A3-\u03F5\u03F7-\u0481\u048A-\u0527\u0531-\u0556\u0559\u0561-\u0587\u05D0-\u05EA\u05F0-\u05F2\u0620-\u064A\u066E\u066F\u0671-\u06D3\u06D5\u06E5\u06E6\u06EE\u06EF\u06FA-\u06FC\u06FF\u0710\u0712-\u072F\u074D-\u07A5\u07B1\u07CA-\u07EA\u07F4\u07F5\u07FA\u0800-\u0815\u081A\u0824\u0828\u0840-\u0858\u08A0\u08A2-\u08AC\u0904-\u0939\u093D\u0950\u0958-\u0961\u0971-\u0977\u0979-\u097F\u0985-\u098C\u098F\u0990\u0993-\u09A8\u09AA-\u09B0\u09B2\u09B6-\u09B9\u09BD\u09CE\u09DC\u09DD\u09DF-\u09E1\u09F0\u09F1\u0A05-\u0A0A\u0A0F\u0A10\u0A13-\u0A28\u0A2A-\u0A30\u0A32\u0A33\u0A35\u0A36\u0A38\u0A39\u0A59-\u0A5C\u0A5E\u0A72-\u0A74\u0A85-\u0A8D\u0A8F-\u0A91\u0A93-\u0AA8\u0AAA-\u0AB0\u0AB2\u0AB3\u0AB5-\u0AB9\u0ABD\u0AD0\u0AE0\u0AE1\u0B05-\u0B0C\u0B0F\u0B10\u0B13-\u0B28\u0B2A-\u0B30\u0B32\u0B33\u0B35-\u0B39\u0B3D\u0B5C\u0B5D\u0B5F-\u0B61\u0B71\u0B83\u0B85-\u0B8A\u0B8E-\u0B90\u0B92-\u0B95\u0B99\u0B9A\u0B9C\u0B9E\u0B9F\u0BA3\u0BA4\u0BA8-\u0BAA\u0BAE-\u0BB9\u0BD0\u0C05-\u0C0C\u0C0E-\u0C10\u0C12-\u0C28\u0C2A-\u0C33\u0C35-\u0C39\u0C3D\u0C58\u0C59\u0C60\u0C61\u0C85-\u0C8C\u0C8E-\u0C90\u0C92-\u0CA8\u0CAA-\u0CB3\u0CB5-\u0CB9\u0CBD\u0CDE\u0CE0\u0CE1\u0CF1\u0CF2\u0D05-\u0D0C\u0D0E-\u0D10\u0D12-\u0D3A\u0D3D\u0D4E\u0D60\u0D61\u0D7A-\u0D7F\u0D85-\u0D96\u0D9A-\u0DB1\u0DB3-\u0DBB\u0DBD\u0DC0-\u0DC6\u0E01-\u0E30\u0E32\u0E33\u0E40-\u0E46\u0E81\u0E82\u0E84\u0E87\u0E88\u0E8A\u0E8D\u0E94-\u0E97\u0E99-\u0E9F\u0EA1-\u0EA3\u0EA5\u0EA7\u0EAA\u0EAB\u0EAD-\u0EB0\u0EB2\u0EB3\u0EBD\u0EC0-\u0EC4\u0EC6\u0EDC-\u0EDF\u0F00\u0F40-\u0F47\u0F49-\u0F6C\u0F88-\u0F8C\u1000-\u102A\u103F\u1050-\u1055\u105A-\u105D\u1061\u1065\u1066\u106E-\u1070\u1075-\u1081\u108E\u10A0-\u10C5\u10C7\u10CD\u10D0-\u10FA\u10FC-\u1248\u124A-\u124D\u1250-\u1256\u1258\u125A-\u125D\u1260-\u1288\u128A-\u128D\u1290-\u12B0\u12B2-\u12B5\u12B8-\u12BE\u12C0\u12C2-\u12C5\u12C8-\u12D6\u12D8-\u1310\u1312-\u1315\u1318-\u135A\u1380-\u138F\u13A0-\u13F4\u1401-\u166C\u166F-\u167F\u1681-\u169A\u16A0-\u16EA\u1700-\u170C\u170E-\u1711\u1720-\u1731\u1740-\u1751\u1760-\u176C\u176E-\u1770\u1780-\u17B3\u17D7\u17DC\u1820-\u1877\u1880-\u18A8\u18AA\u18B0-\u18F5\u1900-\u191C\u1950-\u196D\u1970-\u1974\u1980-\u19AB\u19C1-\u19C7\u1A00-\u1A16\u1A20-\u1A54\u1AA7\u1B05-\u1B33\u1B45-\u1B4B\u1B83-\u1BA0\u1BAE\u1BAF\u1BBA-\u1BE5\u1C00-\u1C23\u1C4D-\u1C4F\u1C5A-\u1C7D\u1CE9-\u1CEC\u1CEE-\u1CF1\u1CF5\u1CF6\u1D00-\u1DBF\u1E00-\u1F15\u1F18-\u1F1D\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FBC\u1FBE\u1FC2-\u1FC4\u1FC6-\u1FCC\u1FD0-\u1FD3\u1FD6-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FF4\u1FF6-\u1FFC\u2071\u207F\u2090-\u209C\u2102\u2107\u210A-\u2113\u2115\u2119-\u211D\u2124\u2126\u2128\u212A-\u212D\u212F-\u2139\u213C-\u213F\u2145-\u2149\u214E\u2183\u2184\u2C00-\u2C2E\u2C30-\u2C5E\u2C60-\u2CE4\u2CEB-\u2CEE\u2CF2\u2CF3\u2D00-\u2D25\u2D27\u2D2D\u2D30-\u2D67\u2D6F\u2D80-\u2D96\u2DA0-\u2DA6\u2DA8-\u2DAE\u2DB0-\u2DB6\u2DB8-\u2DBE\u2DC0-\u2DC6\u2DC8-\u2DCE\u2DD0-\u2DD6\u2DD8-\u2DDE\u2E2F\u3005\u3006\u3031-\u3035\u303B\u303C\u3041-\u3096\u309D-\u309F\u30A1-\u30FA\u30FC-\u30FF\u3105-\u312D\u3131-\u318E\u31A0-\u31BA\u31F0-\u31FF\u3400-\u4DB5\u4E00-\u9FCC\uA000-\uA48C\uA4D0-\uA4FD\uA500-\uA60C\uA610-\uA61F\uA62A\uA62B\uA640-\uA66E\uA67F-\uA697\uA6A0-\uA6E5\uA717-\uA71F\uA722-\uA788\uA78B-\uA78E\uA790-\uA793\uA7A0-\uA7AA\uA7F8-\uA801\uA803-\uA805\uA807-\uA80A\uA80C-\uA822\uA840-\uA873\uA882-\uA8B3\uA8F2-\uA8F7\uA8FB\uA90A-\uA925\uA930-\uA946\uA960-\uA97C\uA984-\uA9B2\uA9CF\uAA00-\uAA28\uAA40-\uAA42\uAA44-\uAA4B\uAA60-\uAA76\uAA7A\uAA80-\uAAAF\uAAB1\uAAB5\uAAB6\uAAB9-\uAABD\uAAC0\uAAC2\uAADB-\uAADD\uAAE0-\uAAEA\uAAF2-\uAAF4\uAB01-\uAB06\uAB09-\uAB0E\uAB11-\uAB16\uAB20-\uAB26\uAB28-\uAB2E\uABC0-\uABE2\uAC00-\uD7A3\uD7B0-\uD7C6\uD7CB-\uD7FB\uF900-\uFA6D\uFA70-\uFAD9\uFB00-\uFB06\uFB13-\uFB17\uFB1D\uFB1F-\uFB28\uFB2A-\uFB36\uFB38-\uFB3C\uFB3E\uFB40\uFB41\uFB43\uFB44\uFB46-\uFBB1\uFBD3-\uFD3D\uFD50-\uFD8F\uFD92-\uFDC7\uFDF0-\uFDFB\uFE70-\uFE74\uFE76-\uFEFC\uFF21-\uFF3A\uFF41-\uFF5A\uFF66-\uFFBE\uFFC2-\uFFC7\uFFCA-\uFFCF\uFFD2-\uFFD7\uFFDA-\uFFDC]/g;

// 2D Canvas drawing primitives.
function jsHasCtx2D(elem) {return !!elem.getContext;}
function jsGetCtx2D(elem) {return elem.getContext('2d');}
function jsBeginPath(ctx) {ctx.beginPath();}
function jsMoveTo(ctx, x, y) {ctx.moveTo(x, y);}
function jsLineTo(ctx, x, y) {ctx.lineTo(x, y);}
function jsStroke(ctx) {ctx.stroke();}
function jsFill(ctx) {ctx.fill();}
function jsRotate(ctx, radians) {ctx.rotate(radians);}
function jsTranslate(ctx, x, y) {ctx.translate(x, y);}
function jsScale(ctx, x, y) {ctx.scale(x, y);}
function jsPushState(ctx) {ctx.save();}
function jsPopState(ctx) {ctx.restore();}
function jsResetCanvas(el) {el.width = el.width;}
function jsDrawImage(ctx, img, x, y) {ctx.drawImage(img, x, y);}
function jsDrawImageClipped(ctx, img, x, y, cx, cy, cw, ch) {
    ctx.drawImage(img, cx, cy, cw, ch, x, y, cw, ch);
}
function jsDrawText(ctx, str, x, y) {ctx.fillText(str, x, y);}
function jsClip(ctx) {ctx.clip();}
function jsArc(ctx, x, y, radius, fromAngle, toAngle) {
    ctx.arc(x, y, radius, fromAngle, toAngle);
}
function jsCanvasToDataURL(el) {return el.toDataURL('image/png');}

// Simulate handles.
// When implementing new handles, remember that passed strings may be thunks,
// and so need to be evaluated before use.

function jsNewHandle(init, read, write, flush, close, seek, tell) {
    var h = {
        read: read || function() {},
        write: write || function() {},
        seek: seek || function() {},
        tell: tell || function() {},
        close: close || function() {},
        flush: flush || function() {}
    };
    init.call(h);
    return h;
}

function jsReadHandle(h, len) {return h.read(len);}
function jsWriteHandle(h, str) {return h.write(str);}
function jsFlushHandle(h) {return h.flush();}
function jsCloseHandle(h) {return h.close();}

function jsMkConWriter(op) {
    return function(str) {
        str = E(str);
        var lines = (this.buf + str).split('\n');
        for(var i = 0; i < lines.length-1; ++i) {
            op.call(console, lines[i]);
        }
        this.buf = lines[lines.length-1];
    }
}

function jsMkStdout() {
    return jsNewHandle(
        function() {this.buf = '';},
        function(_) {return '';},
        jsMkConWriter(console.log),
        function() {console.log(this.buf); this.buf = '';}
    );
}

function jsMkStderr() {
    return jsNewHandle(
        function() {this.buf = '';},
        function(_) {return '';},
        jsMkConWriter(console.warn),
        function() {console.warn(this.buf); this.buf = '';}
    );
}

function jsMkStdin() {
    return jsNewHandle(
        function() {this.buf = '';},
        function(len) {
            while(this.buf.length < len) {
                this.buf += prompt('[stdin]') + '\n';
            }
            var ret = this.buf.substr(0, len);
            this.buf = this.buf.substr(len);
            return ret;
        }
    );
}

// "Weak Pointers". Mostly useless implementation since
// JS does its own GC.

function mkWeak(key, val, fin) {
    fin = !fin? function() {}: fin;
    return {key: key, val: val, fin: fin};
}

function derefWeak(w) {
    return [0, 1, E(w).val];
}

function finalizeWeak(w) {
    return [0, B(A(E(w).fin, [0]))];
}

var _0=function(_1,_2){var _3=E(_1);return _3[0]==0?E(_2):[1,_3[1],new T(function(){return B(_0(_3[2],_2));})];},_4=function(_5,_6){var _7=jsShowI(_5),_8=_7;return new F(function(){return _0(fromJSStr(_8),_6);});},_9=[0,41],_a=[0,40],_b=function(_c,_d,_e){if(_d>=0){return new F(function(){return _4(_d,_e);});}else{return _c<=6?B(_4(_d,_e)):[1,_a,new T(function(){var _f=jsShowI(_d),_g=_f;return B(_0(fromJSStr(_g),[1,_9,_e]));})];}},_h=0,_i=function(_j,_k,_l){return function(_m,_){var _n=jsDrawText(E(_m)[1],E(new T(function(){return [0,toJSStr(E(_l))];}))[1],E(_j)[1],E(_k)[1]);return _h;};},_o=[0],_p=[0],_q=[0,20],_r=[0,_q,_q],_s=[0,175],_t=[0,0],_u=new T(function(){return B(unCStr("Pattern match failure in do expression at pong.hs:204:3-13"));}),_v=function(_w){var _x=jsShow(E(_w)[1]),_y=_x;return new F(function(){return fromJSStr(_y);});},_z=function(_A){return function(_B){return new F(function(){return _0(new T(function(){return B(_v(_A));}),_B);});};},_C=[0,45],_D=function(_E,_F,_G){var _H=function(_I){var _J=new T(function(){return B(A(_E,[[0, -_G]]));});return E(_F)[1]<=6?function(_K){return [1,_C,new T(function(){return B(A(_J,[_K]));})];}:function(_L){return [1,_a,[1,_C,new T(function(){return B(A(_J,[[1,_9,_L]]));})]];};};if(_G>=0){var _M=isDoubleNegativeZero(_G),_N=_M;return E(_N)==0?B(A(_E,[[0,_G]])):B(_H(_));}else{return new F(function(){return _H(_);});}},_O=function(_P,_Q,_R,_S){return new F(function(){return A(_P,[function(_){var _T=jsSetStyle(E(_Q)[1],toJSStr(E(_R)),toJSStr(E(_S)));return _h;}]);});},_U=function(_V){return E(_V);},_W=new T(function(){return B(unCStr("width"));}),_X=new T(function(){return B(unCStr("#524F52"));}),_Y=new T(function(){return B(unCStr("canvas"));}),_Z=new T(function(){return B(unCStr("height"));}),_10=new T(function(){return B(unCStr("display"));}),_11=new T(function(){return B(unCStr("block"));}),_12=new T(function(){return B(unCStr("border"));}),_13=new T(function(){return B(unCStr("1px solid #524F52"));}),_14=new T(function(){return B(unCStr("margin"));}),_15=new T(function(){return B(unCStr("0px auto 0 auto"));}),_16=new T(function(){return B(unCStr("backgroundColor"));}),_17=[0,0],_18=function(_19,_1a,_){var _1b=jsCreateElem(toJSStr(E(_Y))),_1c=_1b,_1d=jsSet(_1c,toJSStr(E(_W)),toJSStr(B(A(_D,[_z,_17,E(_19)[1],_p])))),_1e=jsSet(_1c,toJSStr(E(_Z)),toJSStr(B(A(_D,[_z,_17,E(_1a)[1],_p])))),_1f=[0,_1c],_1g=B(A(_O,[_U,_1f,_10,_11,_])),_1h=_1g,_1i=B(A(_O,[_U,_1f,_12,_13,_])),_1j=_1i,_1k=B(A(_O,[_U,_1f,_14,_15,_])),_1l=_1k,_1m=B(A(_O,[_U,_1f,_16,_X,_])),_1n=_1m;return _1f;},_1o=new T(function(){return B(unCStr("25px italic Monospace"));}),_1p=new T(function(){return [0,toJSStr(_p)];}),_1q=new T(function(){return [0,"rgb("];}),_1r=[0,44],_1s=[1,_1r,_p],_1t=new T(function(){return [0,toJSStr(_1s)];}),_1u=new T(function(){return [0,"rgba("];}),_1v=[0,41],_1w=[1,_1v,_p],_1x=new T(function(){return [0,toJSStr(_1w)];}),_1y=[1,_1x,_p],_1z=function(_1A){var _1B=E(_1A);if(!_1B[0]){var _1C=jsCat([1,_1q,[1,new T(function(){var _1D=String(_1B[1]),_1E=_1D;return [0,_1E];}),[1,_1t,[1,new T(function(){var _1F=String(_1B[2]),_1G=_1F;return [0,_1G];}),[1,_1t,[1,new T(function(){var _1H=String(_1B[3]),_1I=_1H;return [0,_1I];}),_1y]]]]]],E(_1p)[1]),_1J=_1C;return E(_1J);}else{var _1K=jsCat([1,_1u,[1,new T(function(){var _1L=String(_1B[1]),_1M=_1L;return [0,_1M];}),[1,_1t,[1,new T(function(){var _1N=String(_1B[2]),_1O=_1N;return [0,_1O];}),[1,_1t,[1,new T(function(){var _1P=String(_1B[3]),_1Q=_1P;return [0,_1Q];}),[1,_1t,[1,new T(function(){var _1R=String(_1B[4]),_1S=_1R;return [0,_1S];}),_1y]]]]]]]],E(_1p)[1]),_1T=_1K;return E(_1T);}},_1U=new T(function(){return [0,"strokeStyle"];}),_1V=new T(function(){return [0,"fillStyle"];}),_1W=function(_1X,_1Y){return function(_1Z,_){var _20=E(_1Z),_21=_20[1],_22=E(_1V)[1],_23=jsGet(_21,_22),_24=_23,_25=E(_1U)[1],_26=jsGet(_21,_25),_27=_26,_28=E(new T(function(){return [0,B(_1z(_1X))];}))[1],_29=jsSet(_21,_22,_28),_2a=jsSet(_21,_25,_28),_2b=B(A(_1Y,[_20,_])),_2c=_2b,_2d=jsSet(_21,_22,_24),_2e=jsSet(_21,_25,_27);return _h;};},_2f=[0,8],_2g=[0,10],_2h=[0,_2f,_2g],_2i=function(_2j){var _2k=B(A(_2j,[_])),_2l=_2k;return E(_2l);},_2m=function(_2n){return new F(function(){return _2i(function(_){var _=0;return new F(function(){return eval(_2n);});});});},_2o=function(_){var _2p=B(A(_2m,["document.body",_])),_2q=_2p;return [0,_2q];},_2r=function(_){return new F(function(){return _2o(_);});},_2s=function(_){var _=0;return new F(function(){return _2r(_);});},_2t=new T(function(){return B(_2i(_2s));}),_2u=[0,130,205,185],_2v=function(_2w,_){return _h;},_2x=function(_2y){var _2z=E(_2y);if(!_2z[0]){return E(_2v);}else{var _2A=E(_2z[1]);return function(_2B,_){var _2C=E(_2B)[1],_2D=jsMoveTo(_2C,E(_2A[1])[1],E(_2A[2])[1]);return new F(function(){return (function(_2E,_){while(1){var _2F=E(_2E);if(!_2F[0]){return _h;}else{var _2G=E(_2F[1]),_2H=jsLineTo(_2C,E(_2G[1])[1],E(_2G[2])[1]);_2E=_2F[2];continue;}}})(_2z[2],_);});};}},_2I=function(_2J,_2K,_2L,_2M){return new F(function(){return _2x([1,[0,_2J,_2K],[1,[0,_2L,_2K],[1,[0,_2L,_2M],[1,[0,_2J,_2M],[1,[0,_2J,_2K],_p]]]]]);});},_2N=[0,200],_2O=[0,275],_2P=[0,310],_2Q=[0,325],_2R=new T(function(){return B(_2I(_2N,_2O,_2P,_2Q));}),_2S=new T(function(){return [0,"font"];}),_2T=function(_2U,_2V){return function(_2W,_){var _2X=E(_2W),_2Y=_2X[1],_2Z=E(_2S)[1],_30=jsGet(_2Y,_2Z),_31=_30,_32=jsSet(_2Y,_2Z,E(new T(function(){return [0,toJSStr(E(_2U))];}))[1]),_33=B(A(_2V,[_2X,_])),_34=_33,_35=jsSet(_2Y,_2Z,_31);return _h;};},_36=new T(function(){return B(unCStr("20px italic Monospace"));}),_37=[0,220],_38=[0,305],_39=function(_3a){return new F(function(){return _1W(_2u,function(_3b,_){var _3c=E(_3b),_3d=_3c[1],_3e=jsBeginPath(_3d),_3f=B(A(_2R,[[0,_3d],_])),_3g=_3f,_3h=jsStroke(_3d);return new F(function(){return A(new T(function(){return B(_2T(_36,new T(function(){return B(_i(_37,_38,_3a));})));}),[_3c,_]);});});});},_3i=new T(function(){return [0,"mousemove"];}),_3j=new T(function(){return [0,"click"];}),_3k=new T(function(){return B(unCStr("GHC.IO.Exception"));}),_3l=new T(function(){return B(unCStr("base"));}),_3m=new T(function(){return B(unCStr("IOException"));}),_3n=new T(function(){var _3o=hs_wordToWord64(4053623282),_3p=_3o,_3q=hs_wordToWord64(3693590983),_3r=_3q;return [0,_3p,_3r,[0,_3p,_3r,_3l,_3k,_3m],_p];}),_3s=function(_3t){return E(_3n);},_3u=function(_3v){return E(E(_3v)[1]);},_3w=function(_3x,_3y,_3z){var _3A=B(A(_3x,[_])),_3B=B(A(_3y,[_])),_3C=hs_eqWord64(_3A[1],_3B[1]),_3D=_3C;if(!E(_3D)){return [0];}else{var _3E=hs_eqWord64(_3A[2],_3B[2]),_3F=_3E;return E(_3F)==0?[0]:[1,_3z];}},_3G=function(_3H){var _3I=E(_3H);return new F(function(){return _3w(B(_3u(_3I[1])),_3s,_3I[2]);});},_3J=new T(function(){return B(unCStr(": "));}),_3K=[0,41],_3L=new T(function(){return B(unCStr(" ("));}),_3M=new T(function(){return B(unCStr("already exists"));}),_3N=new T(function(){return B(unCStr("does not exist"));}),_3O=new T(function(){return B(unCStr("protocol error"));}),_3P=new T(function(){return B(unCStr("failed"));}),_3Q=new T(function(){return B(unCStr("invalid argument"));}),_3R=new T(function(){return B(unCStr("inappropriate type"));}),_3S=new T(function(){return B(unCStr("hardware fault"));}),_3T=new T(function(){return B(unCStr("unsupported operation"));}),_3U=new T(function(){return B(unCStr("timeout"));}),_3V=new T(function(){return B(unCStr("resource vanished"));}),_3W=new T(function(){return B(unCStr("interrupted"));}),_3X=new T(function(){return B(unCStr("resource busy"));}),_3Y=new T(function(){return B(unCStr("resource exhausted"));}),_3Z=new T(function(){return B(unCStr("end of file"));}),_40=new T(function(){return B(unCStr("illegal operation"));}),_41=new T(function(){return B(unCStr("permission denied"));}),_42=new T(function(){return B(unCStr("user error"));}),_43=new T(function(){return B(unCStr("unsatisified constraints"));}),_44=new T(function(){return B(unCStr("system error"));}),_45=function(_46,_47){switch(E(_46)){case 0:return new F(function(){return _0(_3M,_47);});break;case 1:return new F(function(){return _0(_3N,_47);});break;case 2:return new F(function(){return _0(_3X,_47);});break;case 3:return new F(function(){return _0(_3Y,_47);});break;case 4:return new F(function(){return _0(_3Z,_47);});break;case 5:return new F(function(){return _0(_40,_47);});break;case 6:return new F(function(){return _0(_41,_47);});break;case 7:return new F(function(){return _0(_42,_47);});break;case 8:return new F(function(){return _0(_43,_47);});break;case 9:return new F(function(){return _0(_44,_47);});break;case 10:return new F(function(){return _0(_3O,_47);});break;case 11:return new F(function(){return _0(_3P,_47);});break;case 12:return new F(function(){return _0(_3Q,_47);});break;case 13:return new F(function(){return _0(_3R,_47);});break;case 14:return new F(function(){return _0(_3S,_47);});break;case 15:return new F(function(){return _0(_3T,_47);});break;case 16:return new F(function(){return _0(_3U,_47);});break;case 17:return new F(function(){return _0(_3V,_47);});break;default:return new F(function(){return _0(_3W,_47);});}},_48=[0,125],_49=new T(function(){return B(unCStr("{handle: "));}),_4a=function(_4b,_4c,_4d,_4e,_4f,_4g){var _4h=new T(function(){var _4i=new T(function(){return B(_45(_4c,new T(function(){var _4j=E(_4e);return _4j[0]==0?E(_4g):B(_0(_3L,new T(function(){return B(_0(_4j,[1,_3K,_4g]));},1)));},1)));},1),_4k=E(_4d);return _4k[0]==0?E(_4i):B(_0(_4k,new T(function(){return B(_0(_3J,_4i));},1)));},1),_4l=E(_4f);if(!_4l[0]){var _4m=E(_4b);if(!_4m[0]){return E(_4h);}else{var _4n=E(_4m[1]);return _4n[0]==0?B(_0(_49,new T(function(){return B(_0(_4n[1],[1,_48,new T(function(){return B(_0(_3J,_4h));})]));},1))):B(_0(_49,new T(function(){return B(_0(_4n[1],[1,_48,new T(function(){return B(_0(_3J,_4h));})]));},1)));}}else{return new F(function(){return _0(_4l[1],new T(function(){return B(_0(_3J,_4h));},1));});}},_4o=function(_4p){var _4q=E(_4p);return new F(function(){return _4a(_4q[1],_4q[2],_4q[3],_4q[4],_4q[6],_p);});},_4r=function(_4s,_4t){var _4u=E(_4s);return new F(function(){return _4a(_4u[1],_4u[2],_4u[3],_4u[4],_4u[6],_4t);});},_4v=[0,44],_4w=[0,93],_4x=[0,91],_4y=function(_4z,_4A,_4B){var _4C=E(_4A);return _4C[0]==0?B(unAppCStr("[]",_4B)):[1,_4x,new T(function(){return B(A(_4z,[_4C[1],new T(function(){var _4D=function(_4E){var _4F=E(_4E);return _4F[0]==0?E([1,_4w,_4B]):[1,_4v,new T(function(){return B(A(_4z,[_4F[1],new T(function(){return B(_4D(_4F[2]));})]));})];};return B(_4D(_4C[2]));})]));})];},_4G=function(_4H,_4I){return new F(function(){return _4y(_4r,_4H,_4I);});},_4J=function(_4K,_4L,_4M){var _4N=E(_4L);return new F(function(){return _4a(_4N[1],_4N[2],_4N[3],_4N[4],_4N[6],_4M);});},_4O=[0,_4J,_4o,_4G],_4P=new T(function(){return [0,_3s,_4O,_4Q,_3G];}),_4Q=function(_4R){return [0,_4P,_4R];},_4S=7,_4T=function(_4U){return [0,_o,_4S,_p,_4U,_o,_o];},_4V=function(_4W,_){return new F(function(){return die(new T(function(){return B(_4Q(new T(function(){return B(_4T(_4W));})));}));});},_4X=function(_4Y,_){return new F(function(){return _4V(_4Y,_);});},_4Z=function(_50,_51,_52,_53,_){var _54=jsMoveTo(_53,_50+_52,_51),_55=jsArc(_53,_50,_51,_52,0,6.283185307179586);return _h;},_56=function(_57,_58,_){var _59=jsBeginPath(_58),_5a=B(A(_57,[[0,_58],_])),_5b=_5a,_5c=jsFill(_58);return _h;},_5d=function(_5e,_5f,_5g,_5h){return new F(function(){return _1W(_2u,function(_5i,_){return new F(function(){return _56(new T(function(){return B(_2I([0,_5e],[0,_5f],[0,_5g],[0,_5h]));}),E(_5i)[1],_);});});});},_5j=[0,30],_5k=[0,50],_5l=[0,243,114,89],_5m=function(_5n){var _5o=new T(function(){return E(E(_5n)[3]);}),_5p=new T(function(){return [0,E(_5o)[1]+150];});return function(_5q,_){var _5r=B(A(new T(function(){return B(_1W(_5l,function(_5s,_){return new F(function(){return _56(function(_5t,_){var _5u=E(E(_5n)[1]);return new F(function(){return _4Z(E(_5u[1])[1],E(_5u[2])[1],5,E(_5t)[1],_);});},E(_5s)[1],_);});}));}),[_5q,_])),_5v=_5r,_5w=B(A(new T(function(){return B(_5d(E(_5o)[1],0,E(_5p)[1],5));}),[_5q,_])),_5x=_5w,_5y=B(A(new T(function(){return B(_5d(E(_5o)[1],595,E(_5p)[1],600));}),[_5q,_])),_5z=_5y;return new F(function(){return A(new T(function(){return B(_2T(_36,new T(function(){return B(_1W(_2u,new T(function(){return B(_i(_5j,_5k,new T(function(){return B(unAppCStr("Score: ",new T(function(){return B(_b(0,E(E(_5n)[4])[1],_p));})));},1)));})));})));}),[_5q,_]);});};},_5A=[0,600],_5B=[0,_r,_2h,_s,_t,_o],_5C=new T(function(){return B(unCStr("Restart"));}),_5D=new T(function(){return B(_39(_5C));}),_5E=[0,255,255,255],_5F=new T(function(){return B(unCStr("Game Over"));}),_5G=new T(function(){return [0,toJSStr(E(_5F))];}),_5H=function(_5I,_){var _5J=jsDrawText(E(_5I)[1],E(_5G)[1],200,245);return _h;},_5K=new T(function(){return B(_2T(_1o,_5H));}),_5L=[0,150],_5M=[0,355],_5N=[0,588],_5O=[0,12],_5P=new T(function(){return B(unCStr("Control.Exception.Base"));}),_5Q=new T(function(){return B(unCStr("base"));}),_5R=new T(function(){return B(unCStr("PatternMatchFail"));}),_5S=new T(function(){var _5T=hs_wordToWord64(18445595),_5U=_5T,_5V=hs_wordToWord64(52003073),_5W=_5V;return [0,_5U,_5W,[0,_5U,_5W,_5Q,_5P,_5R],_p];}),_5X=function(_5Y){return E(_5S);},_5Z=function(_60){var _61=E(_60);return new F(function(){return _3w(B(_3u(_61[1])),_5X,_61[2]);});},_62=function(_63){return E(E(_63)[1]);},_64=function(_65,_66){return new F(function(){return _0(E(_65)[1],_66);});},_67=function(_68,_69){return new F(function(){return _4y(_64,_68,_69);});},_6a=function(_6b,_6c,_6d){return new F(function(){return _0(E(_6c)[1],_6d);});},_6e=[0,_6a,_62,_67],_6f=new T(function(){return [0,_5X,_6e,_6g,_5Z];}),_6g=function(_6h){return [0,_6f,_6h];},_6i=new T(function(){return B(unCStr("Irrefutable pattern failed for pattern"));}),_6j=function(_6k,_6l){return new F(function(){return die(new T(function(){return B(A(_6l,[_6k]));}));});},_6m=function(_6n,_6o){var _6p=E(_6o);if(!_6p[0]){return [0,_p,_p];}else{var _6q=_6p[1];if(!B(A(_6n,[_6q]))){return [0,_p,_6p];}else{var _6r=new T(function(){var _6s=B(_6m(_6n,_6p[2]));return [0,_6s[1],_6s[2]];});return [0,[1,_6q,new T(function(){return E(E(_6r)[1]);})],new T(function(){return E(E(_6r)[2]);})];}}},_6t=[0,32],_6u=[0,10],_6v=[1,_6u,_p],_6w=function(_6x){return E(E(_6x)[1])==124?false:true;},_6y=function(_6z,_6A){var _6B=B(_6m(_6w,B(unCStr(_6z)))),_6C=_6B[1],_6D=function(_6E,_6F){return new F(function(){return _0(_6E,new T(function(){return B(unAppCStr(": ",new T(function(){return B(_0(_6A,new T(function(){return B(_0(_6F,_6v));},1)));})));},1));});},_6G=E(_6B[2]);if(!_6G[0]){return new F(function(){return _6D(_6C,_p);});}else{return E(E(_6G[1])[1])==124?B(_6D(_6C,[1,_6t,_6G[2]])):B(_6D(_6C,_p));}},_6H=function(_6I){return new F(function(){return _6j([0,new T(function(){return B(_6y(_6I,_6i));})],_6g);});},_6J=new T(function(){return B(_6H("pong.hs:114:13-51|(Data.Maybe.Just canvasElem)"));}),_6K=new T(function(){return B(unCStr("Pattern match failure in do expression at pong.hs:229:9-19"));}),_6L=new T(function(){return B(unCStr("Start"));}),_6M=function(_6N,_6O){var _6P=_6N%_6O;if(_6N<=0){if(_6N>=0){return E(_6P);}else{if(_6O<=0){return E(_6P);}else{var _6Q=E(_6P);return _6Q==0?0:_6Q+_6O|0;}}}else{if(_6O>=0){if(_6N>=0){return E(_6P);}else{if(_6O<=0){return E(_6P);}else{var _6R=E(_6P);return _6R==0?0:_6R+_6O|0;}}}else{var _6S=E(_6P);return _6S==0?0:_6S+_6O|0;}}},_6T=[0,500],_6U=function(_){var _6V=B(_18(_6T,_5A,_)),_6W=_6V,_6X=E(_6W)[1],_6Y=jsAppendChild(_6X,E(_2t)[1]),_6Z=jsHasCtx2D(_6X),_70=_6Z;if(!E(_70)){return new F(function(){return _4X(_6K,_);});}else{var _71=jsGetCtx2D(_6X),_72=_71,_73=jsResetCanvas(_6X),_74=[0,_72],_75=B(A(_39,[_6L,_74,_])),_76=_75,_77=B(A(_5m,[_5B,_74,_])),_78=_77,_79=jsSetCB(_6X,E(_3j)[1],function(_7a,_7b,_){var _7c=E(_7b);if(!E(E(_7a)[1])){var _7d=E(_7c[1])[1];if(_7d<200){return _h;}else{if(_7d>310){return _h;}else{var _7e=E(_7c[2])[1];if(_7e<275){return _h;}else{if(_7e>325){return _h;}else{var _7f=E(_2t)[1],_7g=jsKillChild(_6X,_7f),_7h=B(_18(_6T,_5A,_)),_7i=_7h,_7j=E(_7i),_7k=_7j[1],_7l=jsAppendChild(_7k,_7f),_7m=jsHasCtx2D(_7k),_7n=_7m;if(!E(_7n)){return new F(function(){return _4X(_u,_);});}else{var _7o=jsGetCtx2D(_7k),_7p=_7o,_7q=nMV([0,_r,_2h,_s,_t,[1,_7j]]),_7r=_7q,_7s=E(_3i)[1],_7t=jsSetCB(_7k,_7s,function(_7u,_){var _7v=rMV(_7r),_7w=_7v;return new F(function(){return mMV(_7r,function(_7x){return [0,new T(function(){var _7y=E(_7x);return [0,_7y[1],_7y[2],new T(function(){return [0,E(E(_7u)[1])[1]-75];}),_7y[4],_7y[5]];}),_h];});});}),_7z=_7t,_7A=function(_7B,_7C,_7D,_7E,_7F,_7G,_7H,_7I){if(_7B+5<_7F){return E(_7I);}else{if(_7B-5>_7F+150){return E(_7I);}else{var _7J=E(_7C),_7K=_7J[1],_7L=function(_7M){var _7N=E(_7G)[1]+1|0;return B(_6M(_7N,4))==0?_7D<0? -_7D>=15?[0,[0,[0,_7B],_7J],[0,[0,_7D],new T(function(){return [0, -E(_7E)[1]];})],[0,_7F],[0,_7N],_7H]:[0,[0,[0,_7B],_7J],[0,new T(function(){if(_7D>=0){var _7O=[0,_7D+1];}else{var _7O=[0,_7D+(-1)];}var _7P=_7O;return _7P;}),new T(function(){var _7Q= -E(_7E)[1];if(_7Q>=0){var _7R=[0,_7Q+2];}else{var _7R=[0,_7Q+(-2)];}var _7S=_7R,_7T=_7S,_7U=_7T;return _7U;})],[0,_7F],[0,_7N],_7H]:_7D>=15?[0,[0,[0,_7B],_7J],[0,[0,_7D],new T(function(){return [0, -E(_7E)[1]];})],[0,_7F],[0,_7N],_7H]:[0,[0,[0,_7B],_7J],[0,new T(function(){if(_7D>=0){var _7V=[0,_7D+1];}else{var _7V=[0,_7D+(-1)];}var _7W=_7V;return _7W;}),new T(function(){var _7X= -E(_7E)[1];if(_7X>=0){var _7Y=[0,_7X+2];}else{var _7Y=[0,_7X+(-2)];}var _7Z=_7Y,_80=_7Z,_81=_80;return _81;})],[0,_7F],[0,_7N],_7H]:[0,[0,[0,_7B],_7J],[0,[0,_7D],new T(function(){return [0, -E(_7E)[1]];})],[0,_7F],[0,_7N],_7H];};if(_7K<595){if(_7K>5){return E(_7I);}else{var _82=B(_7L(_));return [0,_82[1],_82[2],_82[3],_82[4],_82[5]];}}else{var _83=B(_7L(_));return [0,_83[1],_83[2],_83[3],_83[4],_83[5]];}}}},_84=function(_85,_86,_){var _87=rMV(_86),_88=_87,_89=E(_85),_8a=_89[1],_8b=_89[2],_8c=jsResetCanvas(_8b),_8d=B(A(_5m,[_88,[0,_8a],_])),_8e=_8d,_8f=E(_88),_8g=_8f[2],_8h=_8f[3],_8i=_8f[4],_8j=_8f[5],_8k=E(_8f[1]),_8l=_8k[1],_8m=E(_8k[2])[1],_8n=function(_8o){var _8p=function(_8q){var _8r=mMV(_86,function(_8s){return E([0,new T(function(){var _8t=E(_8l)[1];if(_8t+5<500){if(_8t+5>0){var _8u=E(_8g),_8v=_8u[2],_8w=E(_8u[1])[1],_8x=E(_8h),_8y=_8t+_8w,_8z=new T(function(){return [0,_8m+E(_8v)[1]];}),_8A=B(_7A(_8y,_8z,_8w,_8v,_8x[1],_8i,_8j,[0,[0,[0,_8y],_8z],_8u,_8x,_8i,_8j]));}else{var _8B=E(_8g),_8C=_8B[2],_8D= -E(_8B[1])[1],_8E=E(_8h),_8F=5+_8D,_8G=new T(function(){return [0,_8m+E(_8C)[1]];}),_8A=B(_7A(_8F,_8G,_8D,_8C,_8E[1],_8i,_8j,[0,[0,[0,_8F],_8G],[0,[0,_8D],_8C],_8E,_8i,_8j]));}var _8H=_8A,_8I=_8H,_8J=_8I;}else{var _8K=E(_8g),_8L=_8K[2],_8M= -E(_8K[1])[1],_8N=E(_8h),_8O=495+_8M,_8P=new T(function(){return [0,_8m+E(_8L)[1]];}),_8J=B(_7A(_8O,_8P,_8M,_8L,_8N[1],_8i,_8j,[0,[0,[0,_8O],_8P],[0,[0,_8M],_8L],_8N,_8i,_8j]));}var _8Q=_8J,_8R=_8Q,_8S=_8R;return _8S;}),_h]);}),_8T=_8r,_8U=E(_8T),_8V=jsSetTimeout(30,function(_){return new F(function(){return _84(_85,_86,_);});});return _h;};if(_8m>0){return new F(function(){return _8p(_);});}else{var _8W=E(_8l)[1],_8X=E(_8h),_8Y=_8X[1],_8Z=function(_90){var _91=E(_8j);if(!_91[0]){return E(_6J);}else{return new F(function(){return _92(E(_91[1])[1],_8a,_8b,[0,[0,_8Y+75],_5O],_8g,_8X,_8i,_91,_);});}};if(_8W>=_8Y){return _8W<=_8Y+150?B(_8p(_)):B(_8Z(_));}else{return new F(function(){return _8Z(_);});}}};if(_8m<600){return new F(function(){return _8n(_);});}else{var _93=E(_8l)[1],_94=E(_8h),_95=_94[1],_96=function(_97){var _98=E(_8j);if(!_98[0]){return E(_6J);}else{return new F(function(){return _92(E(_98[1])[1],_8a,_8b,[0,[0,_95+75],_5N],_8g,_94,_8i,_98,_);});}};if(_93>=_95){return _93<=_95+150?B(_8n(_)):B(_96(_));}else{return new F(function(){return _96(_);});}}},_92=function(_99,_9a,_9b,_9c,_9d,_9e,_9f,_9g,_){var _9h=jsSetTimeout(30,function(_){var _9i=jsResetCanvas(_9b),_9j=[0,_9a],_9k=B(A(_5m,[[0,[0,new T(function(){return E(E(_9c)[1]);}),new T(function(){return E(E(_9c)[2]);})],_9d,_9e,_9f,_9g],_9j,_])),_9l=_9k,_9m=B(A(_5D,[_9j,_])),_9n=_9m;return new F(function(){return A(_1W,[_5E,function(_9o,_){var _9p=B(A(_5K,[_9o,_])),_9q=_9p;return new F(function(){return A(new T(function(){return B(_2T(_1o,new T(function(){return B(_i(_5L,_5M,new T(function(){return B(unAppCStr("Your total score was ",new T(function(){return B(_b(0,E(_9f)[1],_p));})));},1)));})));}),[_9o,_]);});},_9j,_]);});}),_9r=jsSetCB(_99,E(_3j)[1],function(_9s,_9t,_){var _9u=E(_9t);if(!E(E(_9s)[1])){var _9v=E(_9u[1])[1];if(_9v<200){return _h;}else{if(_9v>310){return _h;}else{var _9w=E(_9u[2])[1];if(_9w<275){return _h;}else{if(_9w>325){return _h;}else{var _9x=jsKillChild(_99,_7f),_9y=B(_18(_6T,_5A,_)),_9z=_9y,_9A=E(_9z),_9B=_9A[1],_9C=jsAppendChild(_9B,_7f),_9D=jsHasCtx2D(_9B),_9E=_9D,_9F=function(_,_9G){var _9H=E(_9G);if(!_9H[0]){return new F(function(){return _4X(_u,_);});}else{var _9I=nMV([0,_9c,_2h,_9e,_t,[1,_9A]]),_9J=_9I,_9K=jsSetCB(_9B,_7s,function(_9L,_){var _9M=rMV(_9J),_9N=_9M;return new F(function(){return mMV(_9J,function(_9O){return [0,new T(function(){var _9P=E(_9O);return [0,_9P[1],_9P[2],new T(function(){return [0,E(E(_9L)[1])[1]-75];}),_9P[4],_9P[5]];}),_h];});});}),_9Q=_9K;return new F(function(){return _84(_9H[1],_9J,_);});}};if(!E(_9E)){return new F(function(){return _9F(_,_o);});}else{var _9R=jsGetCtx2D(_9B),_9S=_9R;return new F(function(){return _9F(_,[1,[0,_9S,_9B]]);});}}}}}}else{return _h;}}),_9T=_9r;return _h;};return new F(function(){return _84([0,_7p,_7k],_7r,_);});}}}}}}else{return _h;}}),_9U=_79;return new T(function(){return E(_9U)==0?false:true;});}},_9V=function(_){return new F(function(){return _6U(_);});};
var hasteMain = function() {B(A(_9V, [0]));};window.onload = hasteMain;