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
import { useTheme } from "~/contexts/ThemeContext";
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
  isLightMode,
}: {
  url: string;
  onLoad?: () => void;
  onError?: (error: string) => void;
  isLightMode: boolean;
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
      <meshStandardMaterial 
        color={isLightMode ? "#6b7280" : "#8b5cf6"} 
        metalness={isLightMode ? 0.1 : 0.3} 
        roughness={isLightMode ? 0.7 : 0.4} 
      />
    </mesh>
  );
}

function Scene({
  modelUrl,
  onLoad,
  onError,
  showGrid,
  isLightMode,
}: {
  modelUrl?: string;
  onLoad?: () => void;
  onError?: (error: string) => void;
  showGrid: boolean;
  isLightMode: boolean;
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

      <ambientLight intensity={isLightMode ? 0.8 : 0.5} />
      <directionalLight position={[10, 10, 5]} intensity={isLightMode ? 0.6 : 1} castShadow />
      <directionalLight position={[-10, -10, -5]} intensity={isLightMode ? 0.5 : 0.3} />

      {showGrid && (
        <Grid
          args={[40, 40]}
          cellSize={1}
          cellThickness={0.5}
          cellColor={isLightMode ? "#e5e7eb" : "#6b7280"}
          sectionSize={5}
          sectionThickness={1}
          sectionColor={isLightMode ? "#d1d5db" : "#374151"}
          fadeDistance={100}
          fadeStrength={0.5}
          followCamera={false}
          infiniteGrid={true}
        />
      )}

      {modelUrl && (
        <Bounds fit clip observe margin={1.2}>
          <Center>
            <Model3D url={modelUrl} onLoad={onLoad} onError={onError} isLightMode={isLightMode} />
          </Center>
        </Bounds>
      )}

      <Environment preset={isLightMode ? "city" : "studio"} />
    </>
  );
}

export function Part3DViewer({ partName, modelUrl, solidModelUrl }: Part3DViewerProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  const { theme } = useTheme();
  const isLightMode = theme === "light";

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
      // Extract just the original filename from the URL
      const urlParts = downloadUrl.split('/');
      const fullFilename = urlParts[urlParts.length - 1];
      
      let originalFilename = fullFilename;
      
      // Pattern: timestamp-part-uuid-originalname.ext
      // Example: 1755410533104-part-8afdac98-47f4-48fa-a091-6980b17553e7-ThinkNas.step
      // Use regex to match: digits-part-uuid pattern and extract everything after
      // Allow for case-insensitive UUID matching
      const partFileRegex = /^\d+-part-[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}-(.+)$/i;
      const partMeshRegex = /^\d+-part-mesh-[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}-(.+)$/i;
      
      let match = fullFilename.match(partFileRegex);
      
      if (match) {
        originalFilename = match[1];
      } else {
        match = fullFilename.match(partMeshRegex);
        if (match) {
          originalFilename = match[1];
        }
      }
      
      // If regex didn't match, try simpler approach - look for last occurrence of UUID pattern
      if (originalFilename === fullFilename) {
        // UUID pattern: 8-4-4-4-12 hex characters (case-insensitive)
        const uuidIndex = fullFilename.search(/[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}/i);
        if (uuidIndex > 0) {
          // Find the end of UUID (36 chars) and skip the dash after it
          const afterUuid = uuidIndex + 36 + 1;
          if (afterUuid < fullFilename.length) {
            originalFilename = fullFilename.substring(afterUuid);
          }
        }
      }
      
      // Final fallback
      if (!originalFilename || originalFilename === fullFilename) {
        const extension = downloadUrl.split(".").pop();
        originalFilename = `${partName || "part"}.${extension}`;
      }
      
      // Fetch the file and create a blob URL to ensure the download attribute works
      fetch(downloadUrl)
        .then(response => response.blob())
        .then(blob => {
          const blobUrl = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = blobUrl;
          link.download = originalFilename;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          // Clean up the blob URL
          setTimeout(() => URL.revokeObjectURL(blobUrl), 100);
        })
        .catch(error => {
          console.error("Download failed:", error);
          // Fallback to direct download
          const link = document.createElement("a");
          link.href = downloadUrl;
          link.download = originalFilename;
          link.target = "_blank";
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        });
    }
  };

  return (
    <div className={`relative w-full h-full ${isLightMode ? 'bg-gray-50' : 'bg-gray-900'}`}>
      <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
        <div className={`${isLightMode ? 'bg-white/70' : 'bg-gray-800/70'} backdrop-blur-sm px-2 py-1 rounded text-xs ${isLightMode ? 'text-gray-700' : 'text-gray-300'}`}>
          {partName || "Part"}
        </div>
        <button
          onClick={() => setShowGrid(!showGrid)}
          className={`p-1.5 ${isLightMode ? 'bg-white/70 hover:bg-gray-100/70 text-gray-700 hover:text-gray-900' : 'bg-gray-800/70 hover:bg-gray-700/70 text-gray-300 hover:text-white'} backdrop-blur-sm rounded transition-colors`}
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
          className={`p-1.5 ${isLightMode ? 'text-blue-600 hover:bg-blue-50' : 'text-blue-400 hover:bg-blue-900/50'} rounded transition-colors`}
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
        <div className={`absolute inset-0 flex items-center justify-center z-20 ${isLightMode ? 'bg-gray-100/50' : 'bg-gray-900/50'}`}>
          <div className="text-center">
            <div className={`inline-block animate-spin rounded-full h-8 w-8 border-b-2 ${isLightMode ? 'border-gray-600' : 'border-gray-300'}`}></div>
            <p className={`${isLightMode ? 'text-gray-600' : 'text-gray-400'} text-sm mt-2`}>Loading 3D model...</p>
          </div>
        </div>
      )}

      {/* Error overlay */}
      {loadError && (
        <div className={`absolute inset-0 flex items-center justify-center z-20 ${isLightMode ? 'bg-gray-100/50' : 'bg-gray-900/50'}`}>
          <div className="text-center">
            <p className={`${isLightMode ? 'text-red-600' : 'text-red-400'} text-sm mb-2`}>Failed to load 3D model</p>
            <p className={`${isLightMode ? 'text-gray-600' : 'text-gray-500'} text-xs`}>{loadError}</p>
          </div>
        </div>
      )}

      <Canvas 
        shadows 
        dpr={[1, 2]} 
        className="touch-none"
        gl={{ 
          alpha: true,
          antialias: true,
          preserveDrawingBuffer: true
        }}
        style={{ 
          background: isLightMode 
            ? 'linear-gradient(to bottom, #f9fafb, #f3f4f6)' 
            : '#111827'
        }}
      >
        <Suspense fallback={null}>
          <Scene
            modelUrl={modelUrl}
            onLoad={() => setIsLoading(false)}
            onError={setLoadError}
            showGrid={showGrid}
            isLightMode={isLightMode}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}
