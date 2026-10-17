var mlib;
var cubeCamera;
var cubeTarget;
var environmentGenerator;   // makes the lighting of the physically based materials from the cube map
var environmentTarget = null;

function initialiseMaterials() {
    // the reflections of the car: a cube map of the surroundings that is refreshed while driving
    cubeTarget = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
    environmentGenerator = new THREE.PMREMGenerator(renderer);
    cubeCamera = new THREE.CubeCamera(1, 10000, cubeTarget);
    var envMap = cubeTarget.texture;

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
    var target = environmentGenerator.fromCubemap(cubeTarget.texture);
    if(environmentTarget) environmentTarget.dispose();
    environmentTarget = target;
    scene.environment = target.texture;
}
