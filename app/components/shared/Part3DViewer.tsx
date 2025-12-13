/* eslint-disable react/no-unknown-property */
import { Canvas, useThree } from "@react-three/fiber";
import {
  OrbitControls,
  Grid,
  Environment,
  PerspectiveCamera,
  Center,
} from "@react-three/drei";
import { Suspense, useEffect, useState, useRef, useCallback } from "react";
import { useTheme } from "~/contexts/ThemeContext";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type * as THREE from "three";
import { Box3, Vector3 } from "three";

interface Part3DViewerProps {
  partName?: string;
  modelUrl?: string;
  solidModelUrl?: string;
  partId?: string;
  quotePartId?: string; // ID for quote parts
  onThumbnailUpdate?: (thumbnailUrl: string) => void;
  autoGenerateThumbnail?: boolean;
  existingThumbnailUrl?: string;
  disableInteraction?: boolean; // Disable orbit controls for thumbnail previews
  hideControls?: boolean; // Hide grid toggle and thumbnail capture buttons
  isQuotePart?: boolean; // Is this a quote part (disables manual thumbnail capture)
  bananaModelUrl?: string; // URL to banana model for scale reference
  showBanana?: boolean; // Whether to show the banana model
}

type PartBoundingBox = { size: Vector3; center: Vector3 };

function Model3D({
  url,
  onLoad,
  onError,
  isLightMode,
  onBoundingBoxComputed,
}: {
  url: string;
  onLoad?: () => void;
  onError?: (error: string) => void;
  isLightMode: boolean;
  onBoundingBoxComputed?: (boundingBox: {
    size: Vector3;
    center: Vector3;
  }) => void;
}) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { camera, controls } = useThree();
  const meshRef = useRef<THREE.Mesh>(null);

  useEffect(() => {
    const loadModel = async () => {
      try {
        setError(null);
        // Extract the actual file extension, ignoring query parameters
        let extension = url.split("?")[0].split(".").pop()?.toLowerCase();

        // If no extension found, try to extract from the path before query params
        if (!extension) {
          const pathMatch = url.match(/\.([a-z0-9]+)(?:\?|$)/i);
          extension = pathMatch ? pathMatch[1].toLowerCase() : undefined;
        }

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
            throw new Error(
              `Unsupported file format: ${extension || "unknown"}`
            );
        }

        loader.load(
          url,
          (
            result: THREE.BufferGeometry | THREE.Group | { scene: THREE.Group }
          ) => {
            if (extension === "stl") {
              setGeometry(result as THREE.BufferGeometry);
            } else if (extension === "obj") {
              // OBJ loader returns a Group, extract the first mesh
              const resultGroup = result as THREE.Group;
              const mesh = resultGroup.children[0] as THREE.Mesh;
              if (mesh && mesh.geometry) {
                setGeometry(mesh.geometry);
              }
            } else if (extension === "gltf" || extension === "glb") {
              // GLTF loader returns a scene with the full model
              // Instead of extracting geometry, we'll render the entire scene
              // For now, find the first mesh in the scene hierarchy
              let foundGeometry: THREE.BufferGeometry | null = null;
              (result as { scene: THREE.Group }).scene.traverse(
                (child: THREE.Object3D) => {
                  if (
                    !foundGeometry &&
                    "isMesh" in child &&
                    child.isMesh &&
                    "geometry" in child
                  ) {
                    const mesh = child as THREE.Mesh;
                    foundGeometry = mesh.geometry;
                  }
                }
              );

              if (foundGeometry) {
                setGeometry(foundGeometry);
              } else {
                throw new Error("No mesh found in GLTF/GLB file");
              }
            }

            onLoad?.();
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
  }, [url, onLoad, onError]);

  // Track if we've already framed the camera for this geometry
  const hasFramedCamera = useRef(false);
  const previousGeometryRef = useRef<THREE.BufferGeometry | null>(null);

  // Reset framing state when the loaded geometry actually changes (new model)
  useEffect(() => {
    if (!geometry) return;
    if (previousGeometryRef.current !== geometry) {
      hasFramedCamera.current = false;
      previousGeometryRef.current = geometry;
    }
  }, [geometry]);

  // Report bounding box whenever geometry changes (for banana positioning)
  useEffect(() => {
    if (!geometry || !meshRef.current) return;

    const box = new Box3().setFromObject(meshRef.current);
    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());

    onBoundingBoxComputed?.({ size: size.clone(), center: center.clone() });
  }, [geometry, onBoundingBoxComputed]);

  // Auto-frame the camera ONLY ONCE when geometry first loads
  useEffect(() => {
    if (!geometry || !meshRef.current || hasFramedCamera.current) return;

    // Compute bounding box
    const box = new Box3().setFromObject(meshRef.current);
    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());

    // Calculate the max dimension
    const maxDim = Math.max(size.x, size.y, size.z);

    // Check if camera is perspective camera
    const fov = "fov" in camera ? (camera as THREE.PerspectiveCamera).fov : 50;
    const fovRadians = fov * (Math.PI / 180);
    let cameraZ = Math.abs(maxDim / 2 / Math.tan(fovRadians / 2));

    // Add some padding (multiply by 1.5 for better framing)
    cameraZ *= 1.5;

    // Position camera to look at the model
    const direction = new Vector3(1, 1, 1).normalize();
    camera.position.copy(direction.multiplyScalar(cameraZ).add(center));
    camera.lookAt(center);

    // Update controls target to center of model (if controls exist)
    if (controls && "target" in controls && "update" in controls) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (controls as any).target.copy(center);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (controls as any).update();
    }

    // Mark that we've framed the camera
    hasFramedCamera.current = true;
  }, [geometry, camera, controls]);

  if (error) {
    // Display error as HTML text in Three.js scene
    return null;
  }

  if (!geometry) {
    return null;
  }

  return (
    <mesh ref={meshRef} geometry={geometry}>
      <meshStandardMaterial
        color={isLightMode ? "#6b7280" : "#8b5cf6"}
        metalness={isLightMode ? 0.1 : 0.3}
        roughness={isLightMode ? 0.7 : 0.4}
      />
    </mesh>
  );
}

// Helper to find the dominant axis (longest dimension) of a bounding box
function getDominantAxis(size: Vector3): "x" | "y" | "z" {
  if (size.x >= size.y && size.x >= size.z) return "x";
  if (size.y >= size.x && size.y >= size.z) return "y";
  return "z";
}

// Calculate rotation to align banana's long axis with part's long axis
function getAlignmentRotation(
  bananaAxis: "x" | "y" | "z",
  partAxis: "x" | "y" | "z"
): [number, number, number] {
  // If axes already match, no rotation needed
  if (bananaAxis === partAxis) return [0, 0, 0];

  // Rotation mappings to align banana axis to part axis
  const rotations: Record<string, [number, number, number]> = {
    // From X to...
    "x-y": [0, 0, Math.PI / 2], // Rotate 90° around Z
    "x-z": [0, Math.PI / 2, 0], // Rotate 90° around Y
    // From Y to...
    "y-x": [0, 0, -Math.PI / 2], // Rotate -90° around Z
    "y-z": [Math.PI / 2, 0, 0], // Rotate 90° around X
    // From Z to...
    "z-x": [0, -Math.PI / 2, 0], // Rotate -90° around Y
    "z-y": [-Math.PI / 2, 0, 0], // Rotate -90° around X
  };

  return rotations[`${bananaAxis}-${partAxis}`] || [0, 0, 0];
}

// Banana model component for scale reference - positions itself based on main part size
function BananaModel({
  url,
  partBoundingBox,
}: {
  url: string;
  isLightMode?: boolean;
  partBoundingBox?: { size: Vector3; center: Vector3 } | null;
}) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [bananaSize, setBananaSize] = useState<Vector3 | null>(null);
  const meshRef = useRef<THREE.Mesh>(null);

  useEffect(() => {
    const loadModel = async () => {
      try {
        let extension = url.split("?")[0].split(".").pop()?.toLowerCase();

        if (!extension) {
          const pathMatch = url.match(/\.([a-z0-9]+)(?:\?|$)/i);
          extension = pathMatch ? pathMatch[1].toLowerCase() : undefined;
        }

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
            console.error(`Unsupported banana model format: ${extension}`);
            return;
        }

        loader.load(
          url,
          (
            result: THREE.BufferGeometry | THREE.Group | { scene: THREE.Group }
          ) => {
            let loadedGeometry: THREE.BufferGeometry | null = null;

            if (extension === "stl") {
              loadedGeometry = result as THREE.BufferGeometry;
            } else if (extension === "obj") {
              const resultGroup = result as THREE.Group;
              const mesh = resultGroup.children[0] as THREE.Mesh;
              if (mesh && mesh.geometry) {
                loadedGeometry = mesh.geometry;
              }
            } else if (extension === "gltf" || extension === "glb") {
              (result as { scene: THREE.Group }).scene.traverse(
                (child: THREE.Object3D) => {
                  if (
                    !loadedGeometry &&
                    "isMesh" in child &&
                    child.isMesh &&
                    "geometry" in child
                  ) {
                    const mesh = child as THREE.Mesh;
                    loadedGeometry = mesh.geometry;
                  }
                }
              );
            }

            if (loadedGeometry) {
              // Center the geometry at origin so it aligns properly with the part
              loadedGeometry.center();

              // Compute banana's bounding box for positioning (after centering)
              loadedGeometry.computeBoundingBox();
              if (loadedGeometry.boundingBox) {
                const size = new Vector3();
                loadedGeometry.boundingBox.getSize(size);
                setBananaSize(size);
              }

              setGeometry(loadedGeometry);
            }
          },
          undefined,
          (error) => {
            console.error("Error loading banana model:", error);
          }
        );
      } catch (err) {
        console.error("Error loading banana model:", err);
      }
    };

    loadModel();
  }, [url]);

  if (!geometry) {
    return null;
  }

  // Calculate rotation to align banana's long axis with part's long axis
  let rotation: [number, number, number] = [0, 0, 0];

  if (partBoundingBox && bananaSize) {
    const partAxis = getDominantAxis(partBoundingBox.size);
    const bananaAxis = getDominantAxis(bananaSize);
    rotation = getAlignmentRotation(bananaAxis, partAxis);
  }

  // Calculate position to place banana next to the part - GUARANTEED NO OVERLAP
  // Use maximum dimensions to ensure bounding spheres don't intersect
  // This is rotation-invariant and bulletproof
  let position: [number, number, number] = [10, 0, 0]; // Very safe default

  if (partBoundingBox && bananaSize) {
    const partAxis = getDominantAxis(partBoundingBox.size);

    // Use the MAXIMUM dimension of each object as "radius" for guaranteed separation
    // This treats each object as a sphere containing it - no rotation can cause overlap
    const partMaxDim = Math.max(
      partBoundingBox.size.x,
      partBoundingBox.size.y,
      partBoundingBox.size.z
    );
    const bananaMaxDim = Math.max(bananaSize.x, bananaSize.y, bananaSize.z);

    // Half of each max dimension = "radius" of bounding sphere
    const partRadius = partMaxDim / 2;
    const bananaRadius = bananaMaxDim / 2;

    // Dynamic gap: scales with part size
    // Small parts (~1"): gap ~1", Large parts (~20"): gap ~2.5"
    const gap = Math.max(1, 0.5 + Math.sqrt(partMaxDim) * 0.3);

    // Total offset = sum of both radii + gap
    // This GUARANTEES no overlap regardless of rotation
    const offsetDistance = partRadius + bananaRadius + gap;

    // Choose offset axis perpendicular to the long axis
    const offsetAxis = partAxis === "x" ? "z" : partAxis === "y" ? "x" : "x";

    if (offsetAxis === "x") {
      position = [offsetDistance, 0, 0];
    } else if (offsetAxis === "z") {
      position = [0, 0, offsetDistance];
    } else {
      position = [0, offsetDistance, 0];
    }
  }

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      position={position}
      rotation={rotation}
    >
      <meshStandardMaterial
        color="#FFE135" // Banana yellow color
        metalness={0.1}
        roughness={0.6}
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
  disableInteraction,
  bananaModelUrl,
  showBanana,
  partBoundingBox,
  onPartBoundingBoxComputed,
}: {
  modelUrl?: string;
  onLoad?: () => void;
  onError?: (error: string) => void;
  showGrid: boolean;
  isLightMode: boolean;
  disableInteraction?: boolean;
  bananaModelUrl?: string;
  showBanana?: boolean;
  partBoundingBox: PartBoundingBox | null;
  onPartBoundingBoxComputed?: (bbox: PartBoundingBox | null) => void;
}) {
  return (
    <>
      <PerspectiveCamera makeDefault position={[10, 10, 10]} fov={50} />
      {!disableInteraction && (
        <OrbitControls
          enablePan={true}
          enableZoom={true}
          enableRotate={true}
          minDistance={1}
          maxDistance={500}
          makeDefault
          dampingFactor={0.05}
          enableDamping={true}
          rotateSpeed={0.5}
          panSpeed={0.5}
        />
      )}

      <ambientLight intensity={isLightMode ? 0.8 : 0.5} />
      <directionalLight
        position={[10, 10, 5]}
        intensity={isLightMode ? 0.6 : 1}
        castShadow
      />
      <directionalLight
        position={[-10, -10, -5]}
        intensity={isLightMode ? 0.5 : 0.3}
      />

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
        <Center>
          <Model3D
            url={modelUrl}
            onLoad={onLoad}
            onError={onError}
            isLightMode={isLightMode}
            onBoundingBoxComputed={onPartBoundingBoxComputed}
          />
        </Center>
      )}

      {/* Banana for scale - positioned to the right of the main model */}
      {showBanana && bananaModelUrl && (
        <BananaModel
          url={bananaModelUrl}
          isLightMode={isLightMode}
          partBoundingBox={partBoundingBox}
        />
      )}

      <Environment preset={isLightMode ? "city" : "studio"} />
    </>
  );
}

export function Part3DViewer({
  partName,
  modelUrl,
  solidModelUrl,
  partId,
  quotePartId,
  onThumbnailUpdate,
  autoGenerateThumbnail = false,
  existingThumbnailUrl,
  disableInteraction = false,
  hideControls = false,
  isQuotePart = false,
  bananaModelUrl,
  showBanana: initialShowBanana = false,
}: Part3DViewerProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  const [isCameraMode, setIsCameraMode] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [hasGeneratedThumbnail, setHasGeneratedThumbnail] = useState(false);
  const [signedModelUrl, setSignedModelUrl] = useState<string | undefined>();
  const [showBanana, setShowBanana] = useState(initialShowBanana);
  const [partBoundingBox, setPartBoundingBox] =
    useState<PartBoundingBox | null>(null);
  const { theme } = useTheme();
  const isLightMode = theme === "light";
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const handleLoad = useCallback(() => setIsLoading(false), []);

  // Fetch signed URL for mesh model if needed
  useEffect(() => {
    const fetchSignedUrl = async () => {
      if (!modelUrl) {
        setSignedModelUrl(modelUrl);
        return;
      }

      // If URL already has AWS signature parameters, it's already signed - use it directly
      if (
        modelUrl.includes("X-Amz-Algorithm") ||
        modelUrl.includes("X-Amz-Signature")
      ) {
        setSignedModelUrl(modelUrl);
        return;
      }

      // Check if this is a mesh URL that needs signing
      if (
        partId &&
        (modelUrl.includes("partMeshUrl") ||
          modelUrl.includes("/mesh/") ||
          modelUrl.includes("supabase"))
      ) {
        try {
          const response = await fetch(`/parts/${partId}/mesh`);
          if (response.ok) {
            const data = await response.json();
            setSignedModelUrl(data.url);
          } else {
            console.error("Failed to get signed mesh URL");
            setSignedModelUrl(modelUrl); // Fallback to original URL
          }
        } catch (error) {
          console.error("Error fetching signed URL:", error);
          setSignedModelUrl(modelUrl); // Fallback to original URL
        }
      } else {
        setSignedModelUrl(modelUrl);
      }
    };

    fetchSignedUrl();
  }, [modelUrl, partId]);

  const generateThumbnailSilently = useCallback(async () => {
    if (!canvasRef.current || !partId) return;

    setHasGeneratedThumbnail(true);

    try {
      const canvas = canvasRef.current;
      canvas.toBlob(async (blob) => {
        if (!blob) {
          console.error("Failed to capture automatic thumbnail");
          return;
        }

        const formData = new FormData();
        const filename = `thumbnail-${partId}-auto-${Date.now()}.png`;
        formData.append("file", blob, filename);

        const response = await fetch(`/parts/${partId}/thumbnail`, {
          method: "POST",
          body: formData,
        });

        if (response.ok) {
          const { thumbnailUrl } = await response.json();
          if (onThumbnailUpdate) {
            onThumbnailUpdate(thumbnailUrl);
          }
        } else {
          console.error("Failed to upload automatic thumbnail");
        }
      }, "image/png");
    } catch (error) {
      console.error("Error generating automatic thumbnail:", error);
    }
  }, [partId, onThumbnailUpdate]);

  // Auto-generate thumbnail after model loads if needed
  useEffect(() => {
    if (
      !isLoading &&
      !hasGeneratedThumbnail &&
      autoGenerateThumbnail &&
      !existingThumbnailUrl &&
      partId &&
      canvasRef.current
    ) {
      // Wait a bit for the model to render properly
      const timer = setTimeout(() => {
        generateThumbnailSilently();
      }, 1000);

      return () => clearTimeout(timer);
    }
  }, [
    isLoading,
    hasGeneratedThumbnail,
    autoGenerateThumbnail,
    existingThumbnailUrl,
    partId,
    generateThumbnailSilently,
  ]);

  // If no mesh URL, show empty state (moved after hooks)
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

  // Wait for signed URL to be fetched
  if (!signedModelUrl) {
    return (
      <div
        className={`relative w-full h-full ${
          isLightMode ? "bg-gray-50" : "bg-gray-900"
        } flex items-center justify-center`}
      >
        <div className="text-center">
          <div
            className={`inline-block animate-spin rounded-full h-8 w-8 border-b-2 ${
              isLightMode ? "border-gray-600" : "border-gray-300"
            }`}
          ></div>
          <p
            className={`${
              isLightMode ? "text-gray-600" : "text-gray-400"
            } text-sm mt-2`}
          >
            Loading model...
          </p>
        </div>
      </div>
    );
  }

  const handleCaptureThumbnail = async () => {
    if (!canvasRef.current || !partId) {
      console.error("Cannot capture thumbnail: missing canvas or partId");
      return;
    }

    setIsCapturing(true);

    try {
      // Get the canvas element and capture it as a blob
      const canvas = canvasRef.current;
      canvas.toBlob(async (blob) => {
        if (!blob) {
          console.error("Failed to capture screenshot");
          setIsCapturing(false);
          return;
        }

        // Create FormData for upload
        const formData = new FormData();
        const filename = `thumbnail-${partId || "part"}-${Date.now()}.png`;
        formData.append("file", blob, filename);

        // Upload the thumbnail using Remix resource route
        const response = await fetch(`/parts/${partId}/thumbnail`, {
          method: "POST",
          body: formData,
        });

        if (response.ok) {
          const { thumbnailUrl } = await response.json();

          // Call the callback to update the part's thumbnail
          if (onThumbnailUpdate) {
            onThumbnailUpdate(thumbnailUrl);
          }

          // Exit camera mode after successful capture
          setIsCameraMode(false);
          setIsCapturing(false);

          // Show success feedback (you might want to add a toast notification here)
        } else {
          console.error("Failed to upload thumbnail");
          setIsCapturing(false);
        }
      }, "image/png");
    } catch (error) {
      console.error("Error capturing thumbnail:", error);
      setIsCapturing(false);
    }
  };

  const handleDownload = () => {
    // Use appropriate route based on whether it's a quote part or regular part
    if (quotePartId && solidModelUrl) {
      window.open(`/quote-parts/${quotePartId}/file`, "_blank");
      return;
    } else if (partId && solidModelUrl) {
      window.open(`/parts/${partId}/file`, "_blank");
      return;
    }

    // Otherwise, fall back to the mesh URL
    const downloadUrl = signedModelUrl || modelUrl;
    if (downloadUrl) {
      window.open(downloadUrl, "_blank");
    }
  };

  return (
    <div
      className={`relative w-full h-full ${
        isLightMode ? "bg-gray-50" : "bg-gray-900"
      }`}
    >
      <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
        <div
          className={`${
            isLightMode ? "bg-white/70" : "bg-gray-800/70"
          } backdrop-blur-sm px-2 py-1 rounded text-xs ${
            isLightMode ? "text-gray-700" : "text-gray-300"
          }`}
        >
          {partName || "Part"}
        </div>
        {!hideControls && (
          <>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowGrid(!showGrid);
              }}
              className={`p-1.5 ${
                isLightMode
                  ? "bg-white/70 hover:bg-gray-100/70 text-gray-700 hover:text-gray-900"
                  : "bg-gray-800/70 hover:bg-gray-700/70 text-gray-300 hover:text-white"
              } backdrop-blur-sm rounded transition-colors`}
              title={showGrid ? "Hide grid" : "Show grid"}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                fill="currentColor"
                viewBox="0 0 16 16"
              >
                <path d="M0 0h5v5H0V0zm6 0h5v5H6V0zm6 0h4v5h-4V0zM0 6h5v5H0V6zm6 0h5v5H6V6zm6 0h4v5h-4V6zM0 12h5v4H0v-4zm6 0h5v4H6v-4zm6 0h4v4h-4v-4z" />
              </svg>
            </button>
            {partId && !isQuotePart && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsCameraMode(!isCameraMode);
                }}
                disabled={isCapturing}
                className={`p-1.5 ${
                  isCameraMode
                    ? "bg-red-600 text-white"
                    : isLightMode
                    ? "bg-white/70 hover:bg-gray-100/70 text-gray-700 hover:text-gray-900"
                    : "bg-gray-800/70 hover:bg-gray-700/70 text-gray-300 hover:text-white"
                } backdrop-blur-sm rounded transition-colors ${
                  isCapturing ? "opacity-50 cursor-not-allowed" : ""
                }`}
                title={isCameraMode ? "Exit camera mode" : "Capture thumbnail"}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  fill="currentColor"
                  viewBox="0 0 16 16"
                >
                  <path d="M10.5 8.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z" />
                  <path d="M2 4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-1.172a2 2 0 0 1-1.414-.586l-.828-.828A2 2 0 0 0 9.172 2H6.828a2 2 0 0 0-1.414.586l-.828.828A2 2 0 0 1 3.172 4H2zm.5 2a.5.5 0 1 1 0-1 .5.5 0 0 1 0 1zm9 2.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0z" />
                </svg>
              </button>
            )}
          </>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleDownload();
          }}
          className={`p-1.5 ${
            isLightMode
              ? "text-blue-600 hover:bg-blue-50"
              : "text-blue-400 hover:bg-blue-900/50"
          } rounded transition-colors`}
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
        {/* Banana for Scale button */}
        {bananaModelUrl && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowBanana(!showBanana);
            }}
            className={`w-[26px] h-[26px] flex items-center justify-center ${
              showBanana ? "bg-yellow-500 backdrop-blur-sm rounded" : ""
            } transition-colors`}
            title={
              showBanana ? "Hide banana for scale" : "Show banana for scale"
            }
          >
            <span className="text-[14px] leading-none">🍌</span>
          </button>
        )}
      </div>

      {/* Bounding box dimensions (all parts) */}
      {partBoundingBox?.size && (
        <div className="absolute bottom-3 left-3 z-10">
          <div
            className={`${
              isLightMode ? "bg-white/70" : "bg-gray-800/70"
            } backdrop-blur-sm px-2 py-1 rounded text-xs ${
              isLightMode ? "text-gray-700" : "text-gray-300"
            }`}
          >
            {(() => {
              // Assumption: mesh scene units are millimeters.
              const mmToIn = (mm: number) => mm / 25.4;
              const fmt = (n: number) => mmToIn(n).toFixed(2);
              const { x, y, z } = partBoundingBox.size;
              return (
                <>
                  {fmt(x)} × {fmt(y)} × {fmt(z)} in
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Camera Mode Capture Button */}
      {isCameraMode && (
        <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 z-20">
          <button
            onClick={handleCaptureThumbnail}
            disabled={isCapturing}
            className={`px-6 py-3 ${
              isCapturing
                ? "bg-gray-600 cursor-not-allowed"
                : "bg-red-600 hover:bg-red-700"
            } text-white font-semibold rounded-full shadow-lg transition-all transform ${
              !isCapturing && "hover:scale-105"
            } flex items-center gap-2`}
          >
            {isCapturing ? (
              <>
                <div className="inline-block animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                Uploading...
              </>
            ) : (
              <>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  fill="currentColor"
                  viewBox="0 0 16 16"
                >
                  <path d="M10.5 8.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z" />
                  <path d="M2 4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-1.172a2 2 0 0 1-1.414-.586l-.828-.828A2 2 0 0 0 9.172 2H6.828a2 2 0 0 0-1.414.586l-.828.828A2 2 0 0 1 3.172 4H2zm.5 2a.5.5 0 1 1 0-1 .5.5 0 0 1 0 1zm9 2.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0z" />
                </svg>
                Capture Thumbnail
              </>
            )}
          </button>
          <div className="text-center mt-2 text-sm text-gray-400">
            {isCapturing
              ? "Processing thumbnail..."
              : "Position the model and click to capture"}
          </div>
        </div>
      )}

      {/* Loading overlay */}
      {isLoading && (
        <div
          className={`absolute inset-0 flex items-center justify-center z-20 ${
            isLightMode ? "bg-gray-100/50" : "bg-gray-900/50"
          }`}
        >
          <div className="text-center">
            <div
              className={`inline-block animate-spin rounded-full h-8 w-8 border-b-2 ${
                isLightMode ? "border-gray-600" : "border-gray-300"
              }`}
            ></div>
            <p
              className={`${
                isLightMode ? "text-gray-600" : "text-gray-400"
              } text-sm mt-2`}
            >
              Loading 3D model...
            </p>
          </div>
        </div>
      )}

      {/* Error overlay */}
      {loadError && (
        <div
          className={`absolute inset-0 flex items-center justify-center z-20 ${
            isLightMode ? "bg-gray-100/50" : "bg-gray-900/50"
          }`}
        >
          <div className="text-center">
            <p
              className={`${
                isLightMode ? "text-red-600" : "text-red-400"
              } text-sm mb-2`}
            >
              Failed to load 3D model
            </p>
            <p
              className={`${
                isLightMode ? "text-gray-600" : "text-gray-500"
              } text-xs`}
            >
              {loadError}
            </p>
          </div>
        </div>
      )}

      <Canvas
        ref={canvasRef}
        shadows
        dpr={[1, 2]}
        className="touch-none"
        gl={{
          alpha: true,
          antialias: true,
          preserveDrawingBuffer: true,
        }}
        style={{
          background: isLightMode
            ? "linear-gradient(to bottom, #f9fafb, #f3f4f6)"
            : "#111827",
        }}
        onCreated={({ gl }) => {
          // Store the renderer for screenshot capture
          if (canvasRef.current) {
            (canvasRef.current as unknown as HTMLCanvasElement) = gl.domElement;
          }
        }}
      >
        <Suspense fallback={null}>
          <Scene
            modelUrl={signedModelUrl}
            onLoad={handleLoad}
            onError={setLoadError}
            showGrid={showGrid}
            isLightMode={isLightMode}
            disableInteraction={disableInteraction}
            bananaModelUrl={bananaModelUrl}
            showBanana={showBanana}
            partBoundingBox={partBoundingBox}
            onPartBoundingBoxComputed={setPartBoundingBox}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}
