var mlib;
var cubeCamera;
var cubeTarget;
var environmentGenerator;   // makes the lighting of the physically based materials from the cube map
var environmentTarget = null;
var cleanTarget, cleanCamera, cleanScene;   // the cube map with its invalid numbers taken out, see updateReflections

function initialiseMaterials() {
    // the reflections of the car: a cube map of the surroundings that is refreshed while driving
    cubeTarget = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
    environmentGenerator = new THREE.PMREMGenerator(renderer);
    cubeCamera = new THREE.CubeCamera(0.1, 10000, cubeTarget); // near: the road is only a few decimetres below the car

    // A copy of the cube map without invalid numbers. One pixel that is not a number (a shader of a dented car, of a car
    // seen from very close, the ghost around the camera) was spread over the whole lighting by the filtering, the next
    // cube map was then drawn with that lighting and stayed broken: the screen went black for the rest of the race.
    cleanTarget = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, depthBuffer: false });
    cleanCamera = new THREE.CubeCamera(0.1, 100, cleanTarget);
    cleanScene = new THREE.Scene();
    cleanScene.add(new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), new THREE.ShaderMaterial({
        uniforms: { tCube: { value: cubeTarget.texture } },
        vertexShader: "varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
        fragmentShader: "uniform samplerCube tCube; varying vec3 vDir;" +
            "void main() { vec4 c = textureCube(tCube, normalize(vDir));" +
            // (the comparison also catches a NaN where a compiler leaves isnan out)
            "  if (any(isnan(c)) || any(isinf(c)) || !(c.r + c.g + c.b + c.a < 60000.0)) c = vec4(0.0);" +
            "  gl_FragColor = max(c, vec4(0.0)); }",
        side: THREE.BackSide, depthTest: false, depthWrite: false
    })));
    var envMap = cleanTarget.texture;

    mlib = {
        body: {
            "Orange": new THREE.MeshLambertMaterial( { color: 0x883300, envMap: envMap, combine: THREE.MixOperation, reflectivity: 0.1 } ),
            "Red": new THREE.MeshLambertMaterial( { color: 0x660000, envMap: envMap, combine: THREE.MixOperation, reflectivity: 0.1 } ),
            "Blue": new THREE.MeshLambertMaterial( { color: 0x113355, envMap: envMap, combine: THREE.MixOperation, reflectivity: 0.1 } ),
            "Black": new THREE.MeshLambertMaterial( { color: 0x000000, envMap: envMap, combine: THREE.MixOperation, reflectivity: 0.2 } ),
            "White": new THREE.MeshLambertMaterial( { color: 0xffffff, envMap: envMap, combine: THREE.MixOperation, reflectivity: 0.2 } )
        },
        "Chrome": new THREE.MeshLambertMaterial( { color: 0xffffff, envMap: envMap  } ),

        "Dark chrome": new THREE.MeshLambertMaterial( { color: 0x444444, envMap: envMap } ),

        "Black rough": new THREE.MeshLambertMaterial( { color: 0x050505 } ),

        "Dark glass": new THREE.MeshLambertMaterial( { color: 0x101020, envMap: envMap, opacity: 0.5, transparent: true } ),
        "Orange glass": new THREE.MeshLambertMaterial( { color: 0xffbb00, opacity: 0.5, transparent: true } ),
        "Red glass": new THREE.MeshLambertMaterial( { color: 0xff0000, opacity: 0.5, transparent: true } ),

        "Black metal": new THREE.MeshLambertMaterial( { color: 0x222222, envMap: envMap, combine: THREE.MultiplyOperation } ),
        "Orange metal": new THREE.MeshLambertMaterial( { color: 0xff6600, envMap: envMap, combine: THREE.MultiplyOperation } )
    };
    
    scene.add(cubeCamera);
}

// Draws the cube map of the surroundings and the copy of it without invalid numbers (six small draws), which the
// materials and the lighting use
function updateReflections(renderer, scene) {
    cubeCamera.update(renderer, scene);
    cleanCamera.update(renderer, cleanScene);
}
/*
mlib.body.push( [ "Carmine", new THREE.MeshPhongMaterial( { color: 0x770000, specular: 0xffaaaa, envMap: envMap, combine: THREE.MultiplyOperation } ) ] );
mlib.body.push( [ "Gold", new THREE.MeshPhongMaterial( { color: 0xaa9944, specular: 0xbbaa99, shininess: 50, envMap: envMap, combine: THREE.MultiplyOperation } ) ] );
mlib.body.push( [ "Bronze", new THREE.MeshPhongMaterial( { color: 0x150505, specular: 0xee6600, shininess: 10, envMap: envMap, combine: THREE.MixOperation, reflectivity: 0.2 } ) ] );
mlib.body.push( [ "Chrome", new THREE.MeshPhongMaterial( { color: 0xffffff, specular: 0xffffff, envMap: envMap, combine: THREE.MultiplyOperation } ) ] );
*/

// The materials of glTF cars are physically based: they are lit by, and reflect, the surroundings. The cube map that
// shows the surroundings of the car is filtered by roughness (PMREM) and used as the lighting of the scene (scene.environment),
// which only physically based materials use. The materials of the track and of the original cars are not changed by it.
function updateEnvironment() {
    // (into the same target every time: no new textures to make and to throw away, which is why it can be done often)
    environmentTarget = environmentGenerator.fromCubemap(cleanTarget.texture, environmentTarget);
    scene.environment = environmentTarget.texture;
}
