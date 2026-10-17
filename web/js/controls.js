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
    // only use pads with the layout this code expects (an axis and at least 8 buttons)
    if(gpad && gpad.connected && gpad.axes.length > 0 && gpad.buttons.length > 7) {
        var steer = gpad.axes[0] || 0;
        car.turnAngle -= (car.turnAngle - (car.maxTurn * Math.pow(steer, 4) * getSign(steer))) / 3;
        car.throttle = gpad.buttons[7].value;
        car.brakePedal = gpad.buttons[6].value;
        gamepadOwnsPedals = true;
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
