/* eslint-disable react/no-unknown-property */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState, useCallback } from "react";
import { Canvas } from "@react-three/fiber";
import {
  Environment,
  Center,
  Bounds,
  useBounds,
} from "@react-three/drei";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type * as THREE from "three";

interface HiddenThumbnailGeneratorProps {
  modelUrl: string;
  partId: string;
  onComplete?: () => void;
  onError?: (error: string) => void;
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
  const bounds = useBounds();

  useEffect(() => {
    const loadModel = async () => {
      try {
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
          (result: any) => {
            if (extension === "stl") {
              setGeometry(result);
            } else if (extension === "obj") {
              const mesh = result.children[0];
              if (mesh && mesh.geometry) {
                setGeometry(mesh.geometry);
              }
            } else if (extension === "gltf" || extension === "glb") {
              const mesh = result.scene.children[0];
              if (mesh && mesh.geometry) {
                setGeometry(mesh.geometry);
              }
            }

            // Wait for rendering and bounds fitting to complete
            setTimeout(() => {
              bounds.refresh().fit();
              setTimeout(() => {
                onLoad?.();
              }, 500);
            }, 100);
          },
          undefined,
          (error) => {
            console.error("Error loading model for thumbnail:", error);
            onError?.(error instanceof Error ? error.message : "Failed to load model");
          }
        );
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Failed to load model";
        onError?.(errorMessage);
      }
    };

    loadModel();
  }, [url, bounds, onLoad, onError]);

  if (!geometry) {
    return null;
  }

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color="#6b7280" metalness={0.1} roughness={0.7} />
    </mesh>
  );
}

export function HiddenThumbnailGenerator({
  modelUrl,
  partId,
  onComplete,
  onError,
}: HiddenThumbnailGeneratorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [hasCaptured, setHasCaptured] = useState(false);

  const captureAndUploadThumbnail = useCallback(async () => {
    if (!canvasRef.current || hasCaptured) return;

    setHasCaptured(true);

    try {
      const canvas = canvasRef.current;
      
      canvas.toBlob(async (blob) => {
        if (!blob) {
          console.error("Failed to capture thumbnail");
          onError?.("Failed to capture thumbnail");
          return;
        }

        const formData = new FormData();
        const filename = `thumbnail-${partId}-auto-${Date.now()}.png`;
        formData.append('file', blob, filename);

        const response = await fetch(`/parts/${partId}/thumbnail`, {
          method: 'POST',
          body: formData,
        });

        if (response.ok) {
          console.log('Automatic thumbnail generated and uploaded successfully');
          onComplete?.();
        } else {
          console.error('Failed to upload automatic thumbnail');
          onError?.("Failed to upload thumbnail");
        }
      }, 'image/png');
    } catch (error) {
      console.error('Error capturing thumbnail:', error);
      onError?.(error instanceof Error ? error.message : "Error capturing thumbnail");
    }
  }, [hasCaptured, partId, onComplete, onError]);

  useEffect(() => {
    if (isModelLoaded && !hasCaptured) {
      // Wait for scene to settle and bounds to fit properly
      const timer = setTimeout(() => {
        captureAndUploadThumbnail();
      }, 2000);
      
      return () => clearTimeout(timer);
    }
  }, [isModelLoaded, hasCaptured, captureAndUploadThumbnail]);

  return (
    <div 
      style={{
        position: 'fixed',
        top: '-9999px',
        left: '-9999px',
        width: '512px',
        height: '512px',
        visibility: 'hidden',
        pointerEvents: 'none',
        background: '#f3f4f6',
      }}
    >
      <Canvas
        ref={canvasRef}
        camera={{ position: [10, 10, 10], fov: 35 }}
        gl={{
          alpha: false,
          antialias: true,
          preserveDrawingBuffer: true,
        }}
        onCreated={({ gl }) => {
          if (canvasRef.current) {
            (canvasRef.current as any) = gl.domElement;
          }
          // Set the clear color to light gray
          gl.setClearColor('#f3f4f6', 1);
        }}
      >
        <color attach="background" args={['#f3f4f6']} />
        
        <ambientLight intensity={0.9} />
        <directionalLight position={[10, 10, 5]} intensity={0.5} />
        <directionalLight position={[-10, -10, -5]} intensity={0.3} />
        <pointLight position={[0, 10, 0]} intensity={0.2} />

        <Bounds fit clip observe margin={1.2}>
          <Center>
            <Model3D
              url={modelUrl}
              onLoad={() => {
                setIsModelLoaded(true);
              }}
              onError={(error) => {
                console.error("Model loading error:", error);
                onError?.(error);
              }}
            />
          </Center>
        </Bounds>

        <Environment preset="studio" background={false} />
      </Canvas>
    </div>
  );
}