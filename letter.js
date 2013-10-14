// Letter: a drag-droppable letter object.
// Copyright 2013 (C) Ralph Thomas

(function() {

//
// Letter comes in three parts:
//  1. The actual draggable object.
//  2. A "home" where a letter lives or can be dropped to.
//  3. A respawner, which is bound to a home and creates a letter when one is removed.
//

var id = new WebKitCSSMatrix();
//
// An array of all the live home instances. We iterate these to update them when the document gets resized.
//
var homeInstances = [];
var registeredResizeListener = false;

function addHomeInstance(home) {
    homeInstances.push(home);
    if (!registeredResizeListener) {
        registeredResizeListener = true;
        window.addEventListener('resize', function() {
            for (var i = 0; i < homeInstances.length; ++i)
                homeInstances[i].update();
        }, true);
    }
}
function removeHomeInstance(home) {
    var idx = homeInstances.indexOf(home);
    if (idx != -1) homeInstances.splice(idx, 1);
}

function findNearestHome(x, y, maxDistance) {
    // Keep the distances squared to avoid a sqrt.
    maxDistance = maxDistance * maxDistance;
    var nearest = null;
    var shortestDistance = Number.MAX_VALUE;
    for (var i = 0; i < homeInstances.length; i++) {
        if (!homeInstances[i].isEmpty()) continue;
        var center = homeInstances[i].centerPoint();
        var dx = x - center.x;
        var dy = y - center.y;
        var distance = dx * dx + dy * dy;
        if (distance < shortestDistance) {
            shortestDistance = distance;
            nearest = homeInstances[i];
        }
    }
    if (shortestDistance < maxDistance) return nearest;
    return null;
}

//
// Home, keeps a letter or respawner. It ought to know its neighbors for reading out spellings.
//
function Home(domElement) {
    this._element = domElement;
    this._transform = null;
    this._letters = [];
    addHomeInstance(this);
}
Home.prototype.dispose = function() {
    removeHomeInstance(this);
}
Home.prototype.addLetter = function(letter) {
    if (this._onAddLetter) this._onAddLetter(letter);
    var idx = this._letters.indexOf(letter);
    if (idx == -1) this._letters.push(letter);
    if (!this._transform) this.update();
    letter.setHomeTransform(this._transform);
}
Home.prototype.removeLetter = function(letter) {
    if (this._onRemoveLetter) this._onRemoveLetter(letter);
    var idx = this._letters.indexOf(letter);
    if (idx != -1) this._letters.splice(idx, 1);
}
Home.prototype.update = function() {
    // Cheap-o; don't use transforms on anything else.
    var offset = { x: 0, y: 0 };
    var e = this._element;
    while (e) {
        offset.x += e.offsetLeft;
        offset.y += e.offsetTop;
        e = e.offsetParent;
    }
    this._transform = id.translate(offset.x, offset.y);

    var cstyle = window.getComputedStyle(this._element);
    this._size = { w: parseInt(cstyle.width, 10), h: parseInt(cstyle.height, 10) };

    for (var i = 0; i < this._letters.length; i++)
        this._letters[i].setHomeTransform(this._transform);
}
Home.prototype.transform = function() { return this._transform; }
Home.prototype.centerPoint = function() {
    return { x: this._transform.e + this._size.w / 2, y: this._transform.f + this._size.h / 2 };
}
Home.prototype.isEmpty = function(letter) { return this._letters.length == 0; }

//
// Respawner, adapts a home to create new letters.
//
function Respawner(domElement, template) {
    this._home = new Home(domElement);
    this._home.isEmpty = function(letter) { if (letter && letter.origin == this) return true; return false; };

    // Use self rather than Function.bind to support iOS 5, which lacks Function.bind.
    var self = this;
    this._home._onAddLetter = function(letter) { self._onAddLetter(letter); };
    this._home._onRemoveLetter = function(letter) { self._onRemoveLetter(letter); };
    this.update = function() { self._home.update(); };
    this._template = template;

    this._replenish();
}
Respawner.prototype._onAddLetter = function(letter) {
    if (this._replenishing) return;
    // We're taking back an old letter. Destroy the letter that we're currently holding.
    if (this._letter) {
        this._purging = true;
        this._letter.disappearAndRemove();
        delete this._purging;
        delete this._letter;
    }
    this._letter = letter;
}
Respawner.prototype._onRemoveLetter = function(letter) {
    if (this._purging) return;
    if (this._letter == letter) this._letter = null;
    // A letter was removed, we need to replenish with a fresh one.
    this._replenish();
}
Respawner.prototype._replenish = function() {
    if (this._letter) return;
    this._replenishing = true;
    var letterElem = this._template.cloneNode(true);
    document.body.appendChild(letterElem);
    this._letter = new Letter(letterElem, this._home);
    this._letter.origin = this._home;
    this._letter.appear();
    delete this._replenishing;
}

//
// Letter, can be dragged between homes.
//
function Letter(domElement, home) {
    this._element = domElement;
    // Use self rather than bind again.
    var self = this;
    this._element.addEventListener('touchstart', function(e) { self._start(e); }, false);
    this._element.addEventListener('touchmove', function(e) { self._move(e); }, false);
    this._element.addEventListener('touchend', function(e) { self._end(e); }, false);
    this._tracking = false;

    this._homeTransform = id;
    this._home = home;
    this._originalHome = home;

    home.addLetter(this);
}
Letter.prototype.appear = function() {
    this._element.style.webkitTransform = this._homeTransform.scale(0.1);
    this._element.style.webkitTransition = 'none';
    document.body.offsetLeft;
    this._element.style.webkitTransform = this._homeTransform;
    this._element.style.webkitTransition = '-webkit-transform 450ms';
}
Letter.prototype.disappearAndRemove = function() {
    if (this._home) this._home.removeLetter(this._letter);

    var cstyle = window.getComputedStyle(this._element);
    var small = new WebKitCSSMatrix(cstyle.webkitTransform).scale(0.05);
    this._element.style.webkitTransition = '-webkit-transform 450ms';
    this._element.style.webkitTransform = small;
    var self = this;
    this._element.addEventListener('webkitTransitionEnd', function() { 
        document.body.removeChild(self._element);
        }, true);
}
var lastZIndex = 1;
Letter.prototype._start = function(e) {
    e.stopPropagation();
    e.preventDefault();
    // XXX: Really we should just track with arbitrarily many touch points and average
    //      the movement to guard against bad touchscreens. Accidental edge touches are
    //      less of an issue because each letter is pretty small.
    if (this._tracking) return;

    this._tracking = e.changedTouches[0].identifier;
    this._startTransform = new WebKitCSSMatrix(window.getComputedStyle(this._element).webkitTransform);
    this._startPoint = { x: e.changedTouches[0].pageX, y: e.changedTouches[0].pageY };

    this._element.style.webkitTransform = this._startTransform;
    this._element.style.webkitTransition = 'none';
    this._element.style.zIndex = (++lastZIndex);
    
    this._home.removeLetter(this);
    this._home = null;
}
Letter.prototype._move = function(e) {
    e.stopPropagation();
    e.preventDefault();

    if (!this._tracking) return;
    for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        if (t.identifier == this._tracking) {
            var point = { x: t.pageX - this._startPoint.x, y: t.pageY - this._startPoint.y };
            // TODO: Add some rotation based on angle of velocity.
            var tx = this._startTransform.translate(point.x, point.y);
            this._element.style.webkitTransform = tx;
        }
    }
}
Letter.prototype._end = function(e) {
    e.stopPropagation();
    e.preventDefault();

    if (!this._tracking) return;

    for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        if (t.identifier == this._tracking) {
            delete this._tracking;

            var point = { x: t.pageX - this._startPoint.x, y: t.pageY - this._startPoint.y };
            var tx = this._startTransform.translate(point.x, point.y);
            this._element.style.webkitTransform = tx;

            var newHome = findNearestHome(tx.e, tx.f, 128);

            if (!newHome) {
                if (this._originalHome.isEmpty(this)) newHome = this._originalHome;
                else newHome = findNearestHome(tx.e, tx.f, 65536); // XXX: Bogus! Should go back to our respawner!
            }

            if (newHome) {
                this._home = newHome;
                this._home.addLetter(this);
            }
            this._element.style.webkitTransform = this._homeTransform;
            this._element.style.webkitTransition = '-webkit-transform 500ms';
        }
    }
}
Letter.prototype.setHomeTransform = function(t) {
    this._homeTransform = t;
    if (!this._tracking) {
        this._element.style.webkitTransform = this._homeTransform;
        this._element.style.webkitTransition = 'none';
    }
}

if (!window.TBoard) window.TBoard = {};
window.TBoard.Respawner = Respawner;
window.TBoard.Letter = Letter;
window.TBoard.Home = Home;
})();
