var mouseDown = false;
var usingGamepad = false;
var mdX = 0;
var mdY = 0;
var mX = 0;
var mY = 0;
var mLocation;

window.onmousedown = function(e) {
    mouseDown = true;
    //console.log("mouseDown " + e.screenX + ", " + e.screenY);
    mdX = e.screenX;
    mdY = e.screenY;
    
    mLocation = document.createElement("div");
    mLocation.id = "mLocation";
    mLocation.className = "mouseStart";
    mLocation.style.left = e.clientX + "px";
    mLocation.style.top = e.clientY + "px";
    document.body.appendChild(mLocation);
};

window.onmouseup = function() {
    mouseDown = false;
    car.throttle = 0;
    car.brakePedal = 0;
    document.body.removeChild(mLocation);
};

window.onmousemove = function(e) {
    if(mouseDown) {
        mX = e.screenX;
        mY = e.screenY;
        
        var yDiff = (mdY - mY) / 200;
        if(yDiff > 1) yDiff = 1;
        if(yDiff < -1) yDiff = -1;
        if(yDiff > 0) {
            car.throttle = yDiff;
            car.brakePedal = 0;
        } else {
            car.throttle = 0;
            car.brakePedal = -yDiff;
        }
        
        var xDiff = (mX - mdX) / 200;
        if (xDiff > 1)
            xDiff = 1;
        if (xDiff < -1)
            xDiff = -1;
        car.turnAngle = car.maxTurn * Math.pow(xDiff, 2) * getSign(xDiff);
    }
};

// true while the regular gamepad is driving the throttle and brake
var gamepadOwnsPedals = false;

function gamepadUpdate() {
    // a racing wheel (with pedals and shifter) takes priority over a regular gamepad
    if(WheelControls.update(car)) {
        gamepadOwnsPedals = false;
        usingGamepad = true;
        return;
    }

    var gpads = navigator.getGamepads ? navigator.getGamepads() : [];
    var gpad = gpads[0];
    // Only use pads with the standard layout this code expects. Other devices (such as
    // racing wheels) are handled by WheelControls after calibration; reading them here
    // would hold the throttle at zero and block the keyboard.
    var usable = gpad && gpad.connected && gpad.mapping === "standard" && gpad.buttons.length > 7 && gpad.axes.length > 0;
    var steer = usable ? (gpad.axes[0] || 0) : 0;
    var active = usable && (gpad.buttons[7].value > 0.05 || gpad.buttons[6].value > 0.05 || Math.abs(steer) > 0.1);

    // An idle gamepad leaves the keyboard and mouse in control
    if(active || (usable && gamepadOwnsPedals)) {
        car.turnAngle -= (car.turnAngle - (car.maxTurn * Math.pow(steer, 4) * getSign(steer))) / 3;
        car.throttle = gpad.buttons[7].value;
        car.brakePedal = gpad.buttons[6].value;
        gamepadOwnsPedals = active;
        usingGamepad = true;
    } else {
        // release the pedals if the gamepad that held them has gone away
        if(gamepadOwnsPedals) {
            car.throttle = 0;
            car.brakePedal = 0;
            gamepadOwnsPedals = false;
        }
        usingGamepad = false;
    }
}
