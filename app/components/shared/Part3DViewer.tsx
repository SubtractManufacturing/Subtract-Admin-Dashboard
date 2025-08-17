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
  solidModelUrl?: string;
}

function Model3D({
  url,
  onLoad,
  onError,
}: {
  url: string;
  onLoad?: () => void;
  onError?: (error: string) => void;
}) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bounds = useBounds();

  useEffect(() => {
    const loadModel = async () => {
      try {
        setError(null);
        const extension = url.split(".").pop()?.toLowerCase();

        let loader;
        switch (extension) {
          case "stl":
            loader = new STLLoader();
            break;
          case "obj":
            loader = new OBJLoader();
            break;
          case "gltf":
          case "glb":
            loader = new GLTFLoader();
            break;
          default:
            throw new Error(`Unsupported file format: ${extension}`);
        }

        loader.load(
          url,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (result: any) => {
            if (extension === "stl") {
              setGeometry(result);
            } else if (extension === "obj") {
              // OBJ loader returns a Group, extract the first mesh
              const mesh = result.children[0];
              if (mesh && mesh.geometry) {
                setGeometry(mesh.geometry);
              }
            } else if (extension === "gltf" || extension === "glb") {
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
            console.error("Error loading model:", error);
            const errorMessage =
              error instanceof Error ? error.message : "Failed to load model";
            setError(errorMessage);
            onError?.(errorMessage);
          }
        );
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to load model";
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

function Scene({
  modelUrl,
  onLoad,
  onError,
  showGrid,
}: {
  modelUrl?: string;
  onLoad?: () => void;
  onError?: (error: string) => void;
  showGrid: boolean;
}) {
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

      {showGrid && (
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
      )}

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

export function Part3DViewer({ partName, modelUrl, solidModelUrl }: Part3DViewerProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(true);

  // If no mesh URL, show empty state
  if (!modelUrl) {
    return (
      <div className="relative w-full h-full bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-400 text-sm mb-2">No mesh available</p>
          <p className="text-gray-500 text-xs">
            Debug: modelUrl = {String(modelUrl)}
          </p>
        </div>
      </div>
    );
  }

  const handleDownload = () => {
    // Prefer solid model for download, fall back to mesh if not available
    const downloadUrl = solidModelUrl || modelUrl;
    
    if (downloadUrl) {
      const link = document.createElement("a");
      link.href = downloadUrl;
      const extension = downloadUrl.split(".").pop();
      link.download = `${partName || "part"}.${extension}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  return (
    <div className="relative w-full h-full bg-gray-900">
      <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
        <div className="bg-gray-800/70 backdrop-blur-sm px-2 py-1 rounded text-xs text-gray-300">
          {partName || "Part"}
        </div>
        <button
          onClick={() => setShowGrid(!showGrid)}
          className="p-1.5 bg-gray-800/70 backdrop-blur-sm hover:bg-gray-700/70 rounded transition-colors text-gray-300 hover:text-white"
          title={showGrid ? "Hide grid" : "Show grid"}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            fill="currentColor"
            viewBox="0 0 16 16"
          >
            <path d="M0 0h5v5H0V0zm6 0h5v5H6V0zm6 0h4v5h-4V0zM0 6h5v5H0V6zm6 0h5v5H6V6zm6 0h4v5h-4V6zM0 12h5v4H0v-4zm6 0h5v4H6v-4zm6 0h4v4h-4v-4z"/>
          </svg>
        </button>
        <button
          onClick={handleDownload}
          className="p-1.5 text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/50 rounded transition-colors"
          title="Download 3D model"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            fill="currentColor"
            viewBox="0 0 16 16"
          >
            <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z" />
            <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z" />
          </svg>
        </button>
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
          <Scene
            modelUrl={modelUrl}
            onLoad={() => setIsLoading(false)}
            onError={setLoadError}
            showGrid={showGrid}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}
