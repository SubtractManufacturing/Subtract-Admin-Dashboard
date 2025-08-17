/* eslint-disable react/no-unknown-property */
import { Canvas } from "@react-three/fiber";
import {
  OrbitControls,
  Grid,
  Environment,
  PerspectiveCamera,
  Center,
  Bounds,
  useBounds,
} from "@react-three/drei";
import { Suspense, useEffect, useState } from "react";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type * as THREE from "three";

interface Part3DViewerProps {
  partName?: string;
  modelUrl?: string;
}

function Model3D({ url, onLoad, onError }: { url: string; onLoad?: () => void; onError?: (error: string) => void }) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bounds = useBounds();

  useEffect(() => {
    const loadModel = async () => {
      try {
        setError(null);
        const extension = url.split('.').pop()?.toLowerCase();
        
        let loader;
        switch (extension) {
          case 'stl':
            loader = new STLLoader();
            break;
          case 'obj':
            loader = new OBJLoader();
            break;
          case 'gltf':
          case 'glb':
            loader = new GLTFLoader();
            break;
          default:
            throw new Error(`Unsupported file format: ${extension}`);
        }

        loader.load(
          url,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (result: any) => {
            if (extension === 'stl') {
              setGeometry(result);
            } else if (extension === 'obj') {
              // OBJ loader returns a Group, extract the first mesh
              const mesh = result.children[0];
              if (mesh && mesh.geometry) {
                setGeometry(mesh.geometry);
              }
            } else if (extension === 'gltf' || extension === 'glb') {
              // GLTF loader returns a scene, extract the first mesh
              const mesh = result.scene.children[0];
              if (mesh && mesh.geometry) {
                setGeometry(mesh.geometry);
              }
            }
            
            // Fit camera to object with bounds
            setTimeout(() => {
              bounds.refresh().fit();
              onLoad?.();
            }, 100);
          },
          undefined,
          (error) => {
            console.error('Error loading model:', error);
            const errorMessage = error instanceof Error ? error.message : 'Failed to load model';
            setError(errorMessage);
            onError?.(errorMessage);
          }
        );
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to load model';
        setError(errorMessage);
        onError?.(errorMessage);
      }
    };

    loadModel();
  }, [url, bounds, onLoad, onError]);

  if (error) {
    // Display error as HTML text in Three.js scene
    return null;
  }

  if (!geometry) {
    return null;
  }

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color="#8b5cf6" metalness={0.3} roughness={0.4} />
    </mesh>
  );
}

function Scene({ modelUrl, onLoad, onError }: { modelUrl?: string; onLoad?: () => void; onError?: (error: string) => void }) {
  return (
    <>
      <PerspectiveCamera makeDefault position={[5, 5, 5]} fov={50} />
      <OrbitControls
        enablePan={true}
        enableZoom={true}
        enableRotate={true}
        minDistance={2}
        maxDistance={50}
        target={[0, 0, 0]}
      />

      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 5]} intensity={1} castShadow />
      <directionalLight position={[-10, -10, -5]} intensity={0.3} />

      <Grid
        args={[40, 40]}
        cellSize={1}
        cellThickness={0.5}
        cellColor="#6b7280"
        sectionSize={5}
        sectionThickness={1}
        sectionColor="#374151"
        fadeDistance={100}
        fadeStrength={0.5}
        followCamera={false}
        infiniteGrid={true}
      />

      {modelUrl && (
        <Bounds fit clip observe margin={1.2}>
          <Center>
            <Model3D url={modelUrl} onLoad={onLoad} onError={onError} />
          </Center>
        </Bounds>
      )}

      <Environment preset="studio" />
    </>
  );
}

export function Part3DViewer({ partName, modelUrl }: Part3DViewerProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  
  console.log('Part3DViewer props:', { partName, modelUrl });

  // If no mesh URL, show empty state
  if (!modelUrl) {
    return (
      <div className="relative w-full h-full bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-400 text-sm mb-2">No mesh available</p>
          <p className="text-gray-500 text-xs">Debug: modelUrl = {String(modelUrl)}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full bg-gray-900">
      <div className="absolute top-3 left-3 z-10 bg-gray-800/70 backdrop-blur-sm px-2 py-1 rounded text-xs text-gray-300">
        {partName || "Part"} • Drag to rotate • Scroll to zoom
      </div>

      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center z-20 bg-gray-900/50">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-300"></div>
            <p className="text-gray-400 text-sm mt-2">Loading 3D model...</p>
          </div>
        </div>
      )}

      {/* Error overlay */}
      {loadError && (
        <div className="absolute inset-0 flex items-center justify-center z-20 bg-gray-900/50">
          <div className="text-center">
            <p className="text-red-400 text-sm mb-2">Failed to load 3D model</p>
            <p className="text-gray-500 text-xs">{loadError}</p>
          </div>
        </div>
      )}

      <Canvas shadows dpr={[1, 2]} className="touch-none">
        <Suspense fallback={null}>
          <Scene modelUrl={modelUrl} onLoad={() => setIsLoading(false)} onError={setLoadError} />
        </Suspense>
      </Canvas>
    </div>
  );
}
