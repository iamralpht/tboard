// Letter: a drag-droppable letter object.
// Copyright 2013 (C) Ralph Thomas

(function() {
var properties = {};
var events = {};

(function() {
    var d = document.createElement('div');
    function findPrefix(prop) {
        if (d.style[prop] != undefined) return prop;
        if (d.style['-webkit-' + prop] != undefined) return '-webkit-' + prop;
        if (d.style['-moz-' + prop] != undefined) return '-moz-' + prop;
        if (d.style['-ms-' + prop] != undefined) return '-ms-' + prop;
        if (d.style['-o-' + prop] != undefined) return '-o-' + prop;
        return undefined;
    }
    function findEvent(ename, prop) {
        // WebKit, for some reason, supports the unprefixed "transition" property
        // but doesn't support the unprefixed "transitionEnd" event!
        if (d.style['-webkit-' + prop] != undefined) return 'webkit' + ename;
        if (d.style[prop] != undefined) return ename;
        if (d.style['-moz-' + prop] != undefined) return 'moz' + ename;
        if (d.style['-ms-' + prop] != undefined) return 'MS' + ename;
        if (d.style['-o-' + prop] != undefined) return 'o' + ename;
        return undefined;
    }
    properties.transform = findPrefix('transform');
    properties.transition = findPrefix('transition');
    properties.animation = findPrefix('animation');
    events.transitionend = findEvent('TransitionEnd', 'transition');
    events.animationend = findEvent('AnimationEnd', 'animation');

    console.log('properties',  properties, 'events', events);
})();

//
// Letter comes in three parts:
//  1. The actual draggable object.
//  2. A "home" where a letter lives or can be dropped to.
//  3. A respawner, which is bound to a home and creates a letter when one is removed.
//

var id = new FirminCSSMatrix();
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
        var position = homeInstances[i].position();
        var dx = x - position.x;
        var dy = y - position.y;
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
    if (this._afterAddLetter) this._afterAddLetter(letter);
}
Home.prototype.removeLetter = function(letter) {
    if (this._onRemoveLetter) this._onRemoveLetter(letter);
    var idx = this._letters.indexOf(letter);
    if (idx != -1) this._letters.splice(idx, 1);
    if (this._afterRemoveLetter) this._afterRemoveLetter(letter);
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

    for (var i = 0; i < this._letters.length; i++)
        this._letters[i].setHomeTransform(this._transform);
}
Home.prototype.transform = function() { return this._transform; }
Home.prototype.position = function() {
    return { x: this._transform.e, y: this._transform.f };
}
Home.prototype.isEmpty = function(letter) { return this._letters.length == 0; }
Home.prototype.text = function() { if (this._letters.length == 0) return null; return this._letters[0].text(); }
Home.prototype.letters = function() { return this._letters; }

//
// Respawner, adapts a home to create new letters.
//
function Respawner(domElement, template, parentElement) {
    this._parentElement = parentElement || document.body;
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
Respawner.prototype.dispose = function() { this._home.dispose(); }
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
    this._parentElement.appendChild(letterElem);
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
    this._element.addEventListener('touchend', function(e) { self._end(e, false); }, false);
    this._element.addEventListener('touchcancel', function(e) { self._end(e, true); }, false);

    this._element.addEventListener('mousedown', function(e) { self._start(e); }, false);
    this._element.addEventListener('mousemove', function(e) { self._move(e); }, false);
    this._element.addEventListener('mouseup', function(e) { self._end(e,false); }, false);

    this._homeTransform = id;
    this._home = home;
    this._originalHome = home;

    home.addLetter(this);
}
Letter.prototype.appear = function() {
    this._element.style[properties.transform] = this._homeTransform.scale(0.1);
    this._element.style[properties.transition] = 'none';
    document.body.offsetLeft;
    this._element.style[properties.transform] = this._homeTransform;
    this._element.style[properties.transition] = properties.transform + ' 450ms';
}
Letter.prototype.disappearAndRemove = function() {
    if (this._home) this._home.removeLetter(this._letter);

    var cstyle = window.getComputedStyle(this._element);
    var small = new FirminCSSMatrix(cstyle[properties.transform]).scale(0.05);
    this._element.style[properties.transition] = properties.transform + ' 450ms';
    this._element.style[properties.transform] = small;
    var self = this;
    this._element.addEventListener(events.transitionend, function() { 
        self._element.parentElement.removeChild(self._element);
        }, true);
}
Letter.prototype.text = function() { return this._element.textContent; }
var lastZIndex = 1;
Letter.prototype._start = function(e) {
    e.stopPropagation();
    e.preventDefault();
    // XXX: Really we should just track with arbitrarily many touch points and average
    //      the movement to guard against bad touchscreens. Accidental edge touches are
    //      less of an issue because each letter is pretty small.
    if (this.hasOwnProperty('_tracking')) return;

    if (e.type == 'touchstart') {
        this._tracking = e.changedTouches[0].identifier;
        this._startPoint = { x: e.changedTouches[0].pageX, y: e.changedTouches[0].pageY };
    } else {
        // Mousedown
        this._tracking = 'mouse';
        this._startPoint = { x: e.pageX, y: e.pageY };
    }
    this._startTransform = new FirminCSSMatrix(window.getComputedStyle(this._element)[properties.transform]);

    this._element.style[properties.transform] = this._startTransform;
    this._element.style[properties.transition] = 'none';
    this._element.style.zIndex = (++lastZIndex);
    
    this._home.removeLetter(this);
    this._home = null;
}
Letter.prototype._move = function(e) {
    e.stopPropagation();
    e.preventDefault();

    if (!this.hasOwnProperty('_tracking')) return;

    var point = null;

    if (e.type == 'mousemove') {
        point = { x: e.pageX - this._startPoint.x, y: e.pageY - this._startPoint.y };
    } else {
        for (var i = 0; i < e.changedTouches.length; i++) {
            var t = e.changedTouches[i];
            if (t.identifier == this._tracking) {
                point = { x: t.pageX - this._startPoint.x, y: t.pageY - this._startPoint.y };
            }
        }
    }
    if (!point) return;
    // TODO: Add some rotation based on angle of velocity.
    var tx = this._startTransform.translate(point.x, point.y);
    this._element.style[properties.transform] = tx;
}
Letter.prototype._end = function(e, cancelled) {
    e.stopPropagation();
    e.preventDefault();

    if (!this.hasOwnProperty('_tracking')) return;

    var point = null;

    if (e.type == 'mouseup') {
        point = { x: e.pageX - this._startPoint.x, y: e.pageY - this._startPoint.y };
    } else {
        for (var i = 0; i < e.changedTouches.length; i++) {
            var t = e.changedTouches[i];
            if (t.identifier == this._tracking) {
                point = { x: t.pageX - this._startPoint.x, y: t.pageY - this._startPoint.y };
            }
        }
    }

    if (!point) return;

    var tx = this._startTransform.translate(point.x, point.y);
    this._element.style[properties.transform] = tx;

    var newHome = findNearestHome(tx.e, tx.f, 128);

    if (!newHome || cancelled) {
        if (this._originalHome.isEmpty(this)) newHome = this._originalHome;
        else newHome = findNearestHome(tx.e, tx.f, 65536); // XXX: Bogus! Should go back to our respawner!
    }

    if (newHome) {
        this._home = newHome;
        this._home.addLetter(this);
    }

    this._element.style[properties.transform] = this._homeTransform;
    this._element.style[properties.transition] = properties.transform + ' 500ms';
    delete this._tracking;
}
Letter.prototype.setHomeTransform = function(t) {
    this._homeTransform = t;
    if (!this.hasOwnProperty('_tracking')) {
        this._element.style[properties.transform] = this._homeTransform;
        this._element.style[properties.transition] = 'none';
    }
}
Letter.prototype.wave = function(duration, delay) {
    var upTime = 0.3 * duration;
    this._element.style[properties.transition] = properties.transform + ' ' + upTime + 'ms ' + delay + 'ms';
    this._element.style[properties.transform] = this._homeTransform + ' translateY(-20px)';

    var self = this;
    this._element.addEventListener(events.transitionend, function(e) { self._waveEnd(0.7 * duration, e); }, false);
}
Letter.prototype._waveEnd = function(duration, e) {
    console.log('transition end');
    e.srcElement.removeEventListener(events.transitionend, arguments.callee, false);
    // If our transition isn't 'none' then we can keep going. If it has become 'none' then
    // there's a drag in progress.
    if (this._element.style[properties.transition] != 'none') {
        this._element.style[properties.transition] = properties.transform + ' ' + duration + 'ms';
        this._element.style[properties.transform] = this._homeTransform;
    }
}

// A CompletionSet is a list of valid completions (each completion is a list with
// a string for each letter). We use this instead of a raw array so that Groups
// with the same CompletionSet can detect duplicates -- if you already spelled 'cat'
// then you can't use 'cat' again.
function CompletionSet(completions) {
    this._completions = completions;
    this._complete = {};
}
function completionKey(completion) {
    var k = '';
    for (var i = 0; i < completion.length; i++) k += completion[i];
    return k;
}

CompletionSet.prototype.markComplete = function(completion, group) {
    var k = completionKey(completion);
    if (this._complete.hasOwnProperty(k))
        this._complete[k].push(group);
    else
        this._complete[k] = [group];
}
CompletionSet.prototype.markIncomplete = function(completion, group) {
    var k = completionKey(completion);
    if (this._complete.hasOwnProperty(k)) {
        var idx = this._complete[k].indexOf(group);
        if (idx == -1) return;
        this._complete[k].splice(idx, 1);
        if (this._complete[k].length == 1) {
            this._complete[k][0]._validate();
        }
    }
}
CompletionSet.prototype.completions = function() { return this._completions; }
CompletionSet.prototype.completionCount = function(completion) {
    var completedGroups = this._complete[completionKey(completion)];
    return completedGroups ? completedGroups.length : 0;
}

// A Group is a set of homes with a set of permitted values (called completions). When
// a completion is filled out, the homes can be animated away and replaced with the
// completion to form the word. Eventually we can add sounds and other rewards.
function Group(completionSet, homes) {
    this._completionSet = completionSet;
    this._homes = homes;
    this._currentCompletion = null;
    var self = this;
    function validate() { self._validate(); };
    for (var i = 0; i < homes.length; i++) {
        homes[i]._afterAddLetter = validate;
        homes[i]._afterRemoveLetter = validate;
    }
}
Group.prototype._validate = function() {
    // Algorithm: eliminate matches every letter.
    var completions = this._completionSet.completions();
    var matches = [];
    for (var i = 0; i < completions.length; i++) matches.push(completions[i]);

    for (var l = 0; l < this._homes.length; l++) {
        var remaining = [];
        var text = this._homes[l].text();
        if (!text) {
            matches = [];
            break;
        }

        for (var m = 0; m < matches.length; m++) {
           var requiredText = matches[m][l];
           if (requiredText == text) remaining.push(matches[m]);
        }
        matches = remaining;
    }
    if (this._currentCompletion) {
        this._completionSet.markIncomplete(this._currentCompletion, this);
        this._currentCompletion = null;
    }
    if (matches.length > 0) {
        // Awesome! We have a match -- but is it unique?
        var alreadyUsed = this._completionSet.completionCount(matches[0]);
        this._completionSet.markComplete(matches[0], this);
        this._currentCompletion = matches[0];
        if (!alreadyUsed) {
            if (this._onMatch) this._onMatch();
        } else {
            if (this._onDuplicate) this._onDuplicate();
        }
    } else {
        // No match.
        if (this._onNoMatch) this._onNoMatch();
    }
}

function doWave(items) {
    function cleanup(e) {
        e.srcElement.style[properties.animation] = null;
        e.srcElement.removeEventListener(events.animationend, arguments.callee, false);
    }
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var time = i * 30;
        if (item instanceof Home) {
            var letters = item.letters();
            for (var l = 0; l < letters.length; l++) letters[l].wave(500, time);
        } else {
            item.addEventListener(events.animationend, cleanup, false);
            item.style[properties.animation] = 'wave 500ms ' + time + 'ms';
        }
    }
}

function Builder(definition, parentElem) {
    parentElem = parentElem || document.body;
    var board = document.createElement('div');
    board.className = 'screen board';
    if (parentElem) parentElem.appendChild(board);
    var homes = [];

    // Build all of the respawners.
    var respawners = document.createElement('div');
    respawners.className = 'respawners';
    for (var i = 0; i < definition.letters.length; i++) {
        var letter = definition.letters[i];
        var r = document.createElement('div');
        r.className = 'respawn';
        r.id = letter;
        var template = document.createElement('div');
        template.className = 'letter';
        template.textContent = definition.letters[i];
        var home = new TBoard.Respawner(r, template, board);
        respawners.appendChild(r);
        homes.push(home);
    }
    board.appendChild(respawners);

    // Build the center section, left and right.
    var center = document.createElement('div');
    center.className = 'center';
    board.appendChild(center);

    var sections = {};
    if (definition.left) sections.left = definition.left;
    if (definition.right) sections.right = definition.right;
    if (definition.bottom) sections.bottom = definition.bottom;

    for (var k in sections) {
        if (!sections.hasOwnProperty(k)) continue;
        var side = sections[k];
        var e = document.createElement('div');
        e.className = k;

        if (k == 'bottom') board.appendChild(e);
        else center.appendChild(e);

        var ul = document.createElement('ul');
        e.appendChild(ul);
        // Now iterate the possible completions and create the prefixes or suffixes
        // for them.
        for (var c = 0; c < side.length; c++) {
            var completion = side[c];
            var word = completion.word;

            var completionSet = new CompletionSet(completion.completions);
            var length = completion.limit || completion.completions.length;

            for (var w = 0; w < length; w++) {
                var groupHomes = [];
                var li = document.createElement('li');
                ul.appendChild(li);
                // Keep a list of the letter elements to make a reward animation
                // on a correct completion.
                var letterElements = [];
                // Iterate over the word and create homes where they're needed;
                // underscore means home.
                for (var l = 0; l < word.length; l++) {
                    if (word[l] == "_") {
                        var home = document.createElement('div');
                        home.className = 'home';
                        li.appendChild(home)
                        var h = new Home(home);
                        homes.push(h);
                        groupHomes.push(h);
                        letterElements.push(h);
                    } else {
                        if (word[l] === ' ') {
                            li.appendChild(document.createTextNode(' '));
                        } else {
                            var sp = document.createElement('span');
                            sp.textContent = word[l];
                            sp.style.display = 'inline-block'; // We use an animation for the reward, and those only work on blocks.
                            li.appendChild(sp);
                            letterElements.push(sp);
                        }
                    }
                }
                var group = new Group(completionSet, groupHomes);
                function setMatchCallbacks(groupElem, letterElements) {
                    group._onMatch = function() { doWave(letterElements); groupElem.classList.add('correct'); groupElem.classList.remove('duplicate'); };
                    group._onNoMatch = function() { groupElem.classList.remove('correct'); groupElem.classList.remove('duplicate'); };
                    group._onDuplicate = function() { groupElem.classList.add('duplicate'); };
                }
                setMatchCallbacks(li, letterElements);
            }
        }
    }

    for (var i = 0; i < homes.length; i++) homes[i].update();

    return { board: board, homes: homes };
}

// Launcher/start screen.
function Launcher(boardDescriptions) {
    this._element = document.createElement('div');
    this._element.className = 'screen launcher';
    var self = this;
    for (var i = 0; i < boardDescriptions.length; i++) {
        var desc = boardDescriptions[i];
        var launcher = document.createElement('div');
        launcher.className = 'launcher-item';
        launcher.textContent = desc.title;
        function addOpener(l, launcherElem, board) {
            launcher.addEventListener('touchend', function() { l._open(launcherElem, board); }, false);
            launcher.addEventListener('click', function() { l._open(launcherElem, board); }, false);
        }
        addOpener(this, launcher, desc.board);
        this._element.appendChild(launcher);
    }
}
Launcher.prototype.element = function() { return this._element; }
Launcher.prototype._open = function(launcher, desc) {
    var items = Builder(desc);
    var board = items.board;
    var homes = items.homes;
    // Add a back button to the board.
    var back = document.createElement('div');
    back.className = 'back-button';
    back.innerHTML = '&#x21e6;';
    board.appendChild(back);
    
    // Terrible hacks; we shouldn't force so many recalcs :(.
    board.style[properties.transition] = 'none';

    // Now transition it so it looks like we zoomed.
    var dw = document.body.offsetWidth;
    var lw = launcher.offsetWidth;
    var lx = launcher.offsetLeft;
    var ly = launcher.offsetTop;

    var boardTx = id.translate(lx, ly).scale(lw/dw);
    board.style[properties.transform] = boardTx;
    board.style.opacity = 0;

    document.body.appendChild(board);

    for (var i = 0; i < homes.length; i++) homes[i].update();

    document.body.offsetLeft;

    board.style[properties.transition] = null;
    board.style.opacity = 1;
    board.style[properties.transform] = null;
    this._element.style.opacity = 0;
    this._element.style[properties.transform] = boardTx.inverse();
    this._element.style.pointerEvents = 'none';


    function addBack(l, board, homes, boardTx) {
        back.addEventListener('touchend', function() { l._back(board, homes, boardTx); }, false);
        back.addEventListener('click', function() { l._back(board, homes, boardTx); }, false);
    }
    addBack(this, board, homes, boardTx);
}
Launcher.prototype._back = function(from, homes, tx) {
    for (var i = 0; i < homes.length; i++)
        homes[i].dispose();
    from.style.opacity = 0;
    from.style[properties.transform] = tx;
    from.style.pointerEvents = 'none';
    this._element.style.opacity = 1;
    this._element.style[properties.transform] = null;
    this._element.style.pointerEvents = null;
    from.addEventListener(events.transitionend, function(e) {
        document.body.removeChild(e.srcElement);
    }, false);
}

// Evil, but put it here.
window.onload = function onload() {
    document.body.addEventListener('touchstart', function(e) { e.preventDefault(); e.stopPropagation(); }, false);
}

if (!window.TBoard) window.TBoard = {};
window.TBoard.Respawner = Respawner;
window.TBoard.Letter = Letter;
window.TBoard.Home = Home;
window.TBoard.CompletionSet = CompletionSet;
window.TBoard.Group = Group;
window.TBoard.Builder = Builder;
window.TBoard.Launcher = Launcher;
})();
