// stars.js

/*jshint esversion: 8 */

// ------- Loading shaders -------
var shaders_url = {
    'computeShaderPosition': './shaders/computePosition.frag',
    'computeShaderVelocity': './shaders/computeVelocity.frag',
    'particleVertexShader': './shaders/particle.vert',
    'particleFragmentShader': './shaders/particle.frag',
};

var shaders = null;

function ShaderLoader(key, url) {
    // console.log('Started: ' + key);
    return new Promise(
        (resolve, reject) => {
            var vertex_loader = new THREE.FileLoader(THREE.DefaultLoadingManager);
            vertex_loader.setResponseType('text');
            vertex_loader.load(url, function (text) {
                // console.log('Complete: ' + key);
                answer = {};
                answer[key] = text;
                // console.log('Returning: ', answer);
                resolve(answer);
            });
        }
    );
}

async function LoadShaders(urls) {
    const promises = Object.keys(urls).map((key) => ShaderLoader(key, urls[key]));
    // console.log('Created promises');
    const answers = await Promise.all(promises);
    // console.log('All promises done');
    // console.log('Answers', answers);
    let obj_shaders = {};
    for (let i in answers) {
        Object.assign(obj_shaders, answers[i]);
    }
    // console.log(obj_shaders);
    return obj_shaders;
}

// ------- End loading shaders -------


// Start GL
if ( WEBGL.isWebGLAvailable() === false ) {

    document.body.appendChild( WEBGL.getWebGLErrorMessage() );

}

var isIE = /Trident/i.test( navigator.userAgent );
var isEdge = /Edge/i.test( navigator.userAgent );

var hash = document.location.hash.substr( 1 );

if ( hash ) hash = parseInt( hash, 0 );

// Texture width for simulation (each texel is a debris particle)
var WIDTH = hash || ( ( isIE || isEdge ) ? 4 : 64 );

var container, stats;
var camera, scene, renderer, geometry;

var PARTICLES = WIDTH * WIDTH;

document.getElementById( 'protoplanets' ).innerText = PARTICLES;

function change( n ) {

    location.hash = n;
    location.reload();
    return false;

}

var options = '';

for ( var i = 1; i < 8; i ++ ) {

    var j = Math.pow( 2, i );
    options += '<a href="#" onclick="return change(' + j + ')">' + ( j * j ) + '</a> ';

}

document.getElementById( 'options' ).innerHTML = options;

if ( isEdge || isIE ) {

    document.getElementById( 'warning' ).innerText = 'particle counts greater than 16 may not render with ' + ( isEdge ? 'Edge' : 'IE11' );

}

var gpuCompute;
var velocityVariable;
var positionVariable;
var velocityUniforms;
var particleUniforms;
var effectController;

// -------  Start program  -------

LoadShaders(shaders_url)
    .then(
        result => {
            shaders = result;
            // console.log("Shaders loaded!");
            // console.log(shaders);
            
            // 
            init();
            animate();
        },
        error => {
            console.error("Shaders don't loaded!");
            console.error(error.message);
        }
    );

// -------  End program  ---------

function init() {

    container = document.createElement( 'div' );
    document.body.appendChild( container );

    camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 5, 15000 );
    camera.position.y = 120;
    camera.position.z = 400;

    scene = new THREE.Scene();

    renderer = new THREE.WebGLRenderer();
    renderer.setPixelRatio( window.devicePixelRatio );
    renderer.setSize( window.innerWidth, window.innerHeight );
    container.appendChild( renderer.domElement );

    var controls = new THREE.OrbitControls( camera, renderer.domElement );

    effectController = {
        // Can be changed dynamically
        gravityConstant: 100.0,
        density: 0.45,

        // Must restart simulation
        radius: 300,
        height: 8,
        exponent: 0.4,
        maxMass: 15.0,
        velocity: 70,
        velocityExponent: 0.2,
        randVelocity: 0.001
    };

    initComputeRenderer();

    stats = new Stats();
    container.appendChild( stats.dom );

    window.addEventListener( 'resize', onWindowResize, false );

    initGUI();

    initProtoplanets();

    dynamicValuesChanger();

}

function initComputeRenderer() {

    gpuCompute = new GPUComputationRenderer( WIDTH, WIDTH, renderer );

    var dtPosition = gpuCompute.createTexture();
    var dtVelocity = gpuCompute.createTexture();

    fillTextures( dtPosition, dtVelocity );

    velocityVariable = gpuCompute.addVariable( "textureVelocity", shaders.computeShaderVelocity, dtVelocity );
    positionVariable = gpuCompute.addVariable( "texturePosition", shaders.computeShaderPosition, dtPosition );

    gpuCompute.setVariableDependencies( velocityVariable, [ positionVariable, velocityVariable ] );
    gpuCompute.setVariableDependencies( positionVariable, [ positionVariable, velocityVariable ] );

    velocityUniforms = velocityVariable.material.uniforms;

    velocityUniforms[ "gravityConstant" ] = { value: 0.0 };
    velocityUniforms[ "density" ] = { value: 0.0 };

    var error = gpuCompute.init();

    if ( error !== null ) {

        console.error( error );

    }

}

function restartSimulation() {

    var dtPosition = gpuCompute.createTexture();
    var dtVelocity = gpuCompute.createTexture();

    fillTextures( dtPosition, dtVelocity );

    gpuCompute.renderTexture( dtPosition, positionVariable.renderTargets[ 0 ] );
    gpuCompute.renderTexture( dtPosition, positionVariable.renderTargets[ 1 ] );
    gpuCompute.renderTexture( dtVelocity, velocityVariable.renderTargets[ 0 ] );
    gpuCompute.renderTexture( dtVelocity, velocityVariable.renderTargets[ 1 ] );

}

function initProtoplanets() {

    geometry = new THREE.BufferGeometry();

    var positions = new Float32Array( PARTICLES * 3 );
    var p = 0;

    for ( var i = 0; i < PARTICLES; i ++ ) {

        positions[ p ++ ] = ( Math.random() * 2 - 1 ) * effectController.radius;
        positions[ p ++ ] = 0; //( Math.random() * 2 - 1 ) * effectController.radius;
        positions[ p ++ ] = ( Math.random() * 2 - 1 ) * effectController.radius;

    }

    var uvs = new Float32Array( PARTICLES * 2 );
    p = 0;

    for ( var j = 0; j < WIDTH; j ++ ) {

        for ( var i = 0; i < WIDTH; i ++ ) {

            uvs[ p ++ ] = i / ( WIDTH - 1 );
            uvs[ p ++ ] = j / ( WIDTH - 1 );

        }

    }

    geometry.addAttribute( 'position', new THREE.BufferAttribute( positions, 3 ) );
    geometry.addAttribute( 'uv', new THREE.BufferAttribute( uvs, 2 ) );

    particleUniforms = {
        "texturePosition": { value: null },
        "textureVelocity": { value: null },
        "cameraConstant": { value: getCameraConstant( camera ) },
        "density": { value: 0.0 }
    };

    // var textureLoader = new THREE.TextureLoader();
    // var sprite2 = textureLoader.load( 'textures/snowflake2.png' );
    // var material = new THREE.PointsMaterial( { size: 100, map: sprite2, blending: THREE.AdditiveBlending, depthTest: false, transparent: true  } );

    // ShaderMaterial
    var material = new THREE.RawShaderMaterial( {
        uniforms: particleUniforms,
        vertexShader: shaders.particleVertexShader,
        fragmentShader: shaders.particleFragmentShader,
        side: THREE.DoubleSide,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: true } );
    
    material.extensions.drawBuffers = true;

    var particles = new THREE.Points( geometry, material );
    particles.matrixAutoUpdate = false;
    particles.updateMatrix();

    scene.add( particles );

}

function fillTextures( texturePosition, textureVelocity ) {

    var posArray = texturePosition.image.data;
    var velArray = textureVelocity.image.data;

    var radius = effectController.radius;
    var height = effectController.height;
    var exponent = effectController.exponent;
    var maxMass = effectController.maxMass * 1024 / PARTICLES;
    var maxVel = effectController.velocity;
    var velExponent = effectController.velocityExponent;
    var randVel = effectController.randVelocity;

    for ( var k = 0, kl = posArray.length; k < kl; k += 4 ) {

        // Position
        var x, y, z, rr;

        do {

            x = ( Math.random() * 2 - 1 );
            z = ( Math.random() * 2 - 1 );
            rr = x * x + z * z;

        } while ( rr > 1 );

        rr = Math.sqrt( rr );

        var rExp = radius * Math.pow( rr, exponent );

        // Velocity
        var vel = maxVel * Math.pow( rr, velExponent );

        var vx = vel * z + ( Math.random() * 2 - 1 ) * randVel;
        var vy = ( Math.random() * 2 - 1 ) * randVel * 0.05;
        var vz = - vel * x + ( Math.random() * 2 - 1 ) * randVel;

        x *= rExp;
        z *= rExp;
        y = ( Math.random() * 2 - 1 ) * height;

        var mass = Math.random() * maxMass + 1;

        // Fill in texture values
        posArray[ k + 0 ] = x;
        posArray[ k + 1 ] = y;
        posArray[ k + 2 ] = z;
        posArray[ k + 3 ] = 1;

        velArray[ k + 0 ] = vx;
        velArray[ k + 1 ] = vy;
        velArray[ k + 2 ] = vz;
        velArray[ k + 3 ] = mass;

    }

}

function onWindowResize() {

    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();

    renderer.setSize( window.innerWidth, window.innerHeight );

    particleUniforms[ "cameraConstant" ].value = getCameraConstant( camera );

}

function dynamicValuesChanger() {

    velocityUniforms[ "gravityConstant" ].value = effectController.gravityConstant;
    velocityUniforms[ "density" ].value = effectController.density;
    particleUniforms[ "density" ].value = effectController.density;

}

function initGUI() {

    var gui = new dat.GUI();
    // gui.close();

    var folder1 = gui.addFolder( 'Dynamic parameters' );

    folder1.add( effectController, "gravityConstant", 0.0, 1000.0, 0.05 ).onChange( dynamicValuesChanger );
    folder1.add( effectController, "density", 0.0, 10.0, 0.001 ).onChange( dynamicValuesChanger );

    var folder2 = gui.addFolder( 'Static parameters' );

    folder2.add( effectController, "radius", 10.0, 1000.0, 1.0 );
    folder2.add( effectController, "height", 0.0, 1000.0, 0.01 );
    folder2.add( effectController, "exponent", 0.0, 2.0, 0.001 );
    folder2.add( effectController, "maxMass", 1.0, 50.0, 0.1 );
    folder2.add( effectController, "velocity", 0.0, 150.0, 0.1 );
    folder2.add( effectController, "velocityExponent", 0.0, 1.0, 0.01 );
    folder2.add( effectController, "randVelocity", 0.0, 50.0, 0.1 );

    var buttonRestart = {
        restartSimulation: function () {

            restartSimulation();

        }
    };

    folder2.add( buttonRestart, 'restartSimulation' );

    folder1.open();
    folder2.open();

}

function getCameraConstant( camera ) {

    return window.innerHeight / ( Math.tan( THREE.Math.DEG2RAD * 0.5 * camera.fov ) / camera.zoom );

}


function animate() {

    requestAnimationFrame( animate );

    render();
    stats.update();

}

function render() {

    gpuCompute.compute();

    particleUniforms[ "texturePosition" ].value = gpuCompute.getCurrentRenderTarget( positionVariable ).texture;
    particleUniforms[ "textureVelocity" ].value = gpuCompute.getCurrentRenderTarget( velocityVariable ).texture;

    renderer.render( scene, camera );

}