var mouseDown = false;
var usingGamepad = false;
var mdX = 0;
var mdY = 0;
var mX = 0;
var mY = 0;
var mLocation;

window.onmousedown = function(e) {
    // a click in the settings menu is not driving
    if(Settings.isPaused()) return;
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
    if(!mouseDown) return;
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

    // The controller is read through the bindings of the settings menu (by default the left stick steers,
    // and the right and left trigger are the throttle and the brake). Racing wheels are handled by
    // WheelControls after calibration; they are not a controller here.
    var gpad = Settings.controllerPad();
    var usable = !!gpad;
    var steer = usable ? Settings.controllerAnalog("steerRight") - Settings.controllerAnalog("steerLeft") : 0;
    var throttle = usable ? Settings.controllerAnalog("throttle") : 0;
    var brake = usable ? Settings.controllerAnalog("brake") : 0;
    var active = usable && (throttle > 0.05 || brake > 0.05 || Math.abs(steer) > 0.1);

    // An idle gamepad leaves the keyboard and mouse in control
    if(active || (usable && gamepadOwnsPedals)) {
        car.turnAngle -= (car.turnAngle - (car.maxTurn * Math.pow(steer, 4) * getSign(steer))) / 3;
        car.throttle = throttle;
        car.brakePedal = brake;
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
