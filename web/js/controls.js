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
    if(e.target && e.target.closest && e.target.closest("#tuning")) return; // the tuning menu
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
// true once the gamepad has been used, until a key of the keyboard steers or drives: the steering (and its assist) then follows
// the pad every frame, also with the stick centred and the throttle off (a car that coasts into a slide needs the assist too)
var gamepadOwnsSteering = false;

function gamepadUpdate(delta) {
    delta = delta || 1 / 60;
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
    if(active) gamepadOwnsSteering = true;
    if(!usable || car.turnLeft || car.turnRight || car.accelerate || car.brake) gamepadOwnsSteering = false; // the keyboard takes over

    // An idle gamepad leaves the keyboard and mouse in control
    if(active || (usable && (gamepadOwnsPedals || gamepadOwnsSteering))) {
        // The stick is the steering one to one at a standstill; the faster the car goes, the slower the steering follows the stick
        // (like the keyboard), so a small movement at speed is a small movement of the wheels. "Slower at speed" of the gamepad
        // options says how much: the rate is divided by 1 + slow * speed / 10 m/s.
        var target = car.maxTurn * steer;
        var v = car.vehicle;
        var speed = v ? Math.abs(v.u) : 0;
        // The steering assist: when the rear steps out, the front tyres want to point where the car goes (the way a car with a
        // lot of caster steers itself into a slide), so the steering gets a counter-steer added before the slide is a spin.
        if(Settings.option("padAssist") && v && speed > 3) {
            var beta = Math.atan2(v.v, v.u);                 // the slip angle of the car: positive when it moves to the right of where it points
            var dead = 0.035;                                  // two degrees of slip are normal cornering
            var counter = Math.sign(beta) * Math.max(0, Math.abs(beta) - dead) * 1.1;
            target += Math.max(-0.6 * car.maxTurn, Math.min(0.6 * car.maxTurn, counter));
            target = Math.max(-car.maxTurn, Math.min(car.maxTurn, target));
        }
        var slow = Settings.option("padSlow");
        var rate = 6 / (1 + (slow === undefined ? 1.5 : slow) * speed / 10);   // rad/s
        // back towards the middle the wheels go fast at any speed (the tyres straighten themselves): only steering out is slowed
        var towardsCentre = Math.abs(target) < Math.abs(car.turnAngle) && target * car.turnAngle >= 0;
        if(towardsCentre || target * car.turnAngle < 0) rate = Math.max(rate, 5);
        var step = rate * delta;
        if(Math.abs(target - car.turnAngle) <= step) car.turnAngle = target;
        else car.turnAngle += Math.sign(target - car.turnAngle) * step;
        // the pedals only while the pad drives (or just stopped driving), so that a pad that rests does not hold them at zero
        if(active || gamepadOwnsPedals) {
            car.throttle = throttle;
            car.brakePedal = brake;
        }
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
