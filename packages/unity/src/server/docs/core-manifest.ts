import type { UnityCoreStage, UnityDocKind } from "./core.ts";

export type CorePageSpec = {
  topic: string;
  title: string;
  kind: Extract<UnityDocKind, "editor-manual" | "editor-api">;
  slug: string;
};

export type CoreStageSpec = {
  stage: UnityCoreStage;
  name: string;
  verificationQueries: string[];
  pages: CorePageSpec[];
};

const manual = (topic: string, title: string, slug: string): CorePageSpec => ({
  topic,
  title,
  slug,
  kind: "editor-manual",
});
const api = (topic: string, title: string, slug: string): CorePageSpec => ({
  topic,
  title,
  slug,
  kind: "editor-api",
});

export function pageUrl(documentationLine: string, page: CorePageSpec) {
  const section = page.kind === "editor-manual" ? "Manual" : "ScriptReference";
  return `https://docs.unity3d.com/${documentationLine}/Documentation/${section}/${page.slug}.html`;
}

const stage1: CoreStageSpec = {
  stage: 1,
  name: "Serialization and Editor tooling",
  verificationQueries: [
    "serialization rules SerializeReference",
    "prefab variants overrides nested prefabs",
    "AssetDatabase refresh pipeline",
    "custom inspector SerializedObject PropertyDrawer",
  ],
  pages: [
    manual(
      "Script serialization",
      "Script serialization",
      "script-serialization",
    ),
    manual(
      "Script serialization rules",
      "Serialization rules",
      "script-serialization-rules",
    ),
    manual(
      "Custom serialization",
      "Custom serialization",
      "script-serialization-custom-serialization",
    ),
    manual(
      "Serialization best practices",
      "Serialization best practices",
      "script-serialization-best-practices",
    ),
    manual("Domain reload", "Domain Reloading", "domain-reloading"),
    manual(
      "Enter Play Mode settings",
      "Enter Play Mode settings",
      "configurable-enter-play-mode",
    ),
    manual("ScriptableObject", "ScriptableObject", "class-ScriptableObject"),
    manual("Prefabs", "Prefabs", "Prefabs"),
    manual("Prefab variants", "Prefab Variants", "PrefabVariants"),
    manual(
      "Prefab overrides",
      "Prefab instance overrides",
      "PrefabInstanceOverrides",
    ),
    manual("Nested prefabs", "Nested Prefabs", "NestedPrefabs"),
    manual(
      "Prefab Mode",
      "Editing a Prefab in Prefab Mode",
      "EditingInPrefabMode",
    ),
    manual(
      "Extending the Editor",
      "Extending the Editor",
      "ExtendingTheEditor",
    ),
    manual(
      "IMGUI custom inspectors",
      "Create custom Editors with IMGUI",
      "editor-CustomEditors",
    ),
    manual(
      "IMGUI property drawers",
      "Use Property Drawers with IMGUI to customize the Inspector",
      "editor-PropertyDrawers",
    ),
    manual(
      "IMGUI Editor windows",
      "Create custom Editor Windows with IMGUI",
      "editor-EditorWindows",
    ),
    manual(
      "Asset Database",
      "Managing assets with the Asset Database",
      "AssetDatabase",
    ),
    manual(
      "Asset Database refresh",
      "Refreshing the Asset Database",
      "AssetDatabaseRefreshing",
    ),
    manual(
      "Multi-scene editing",
      "Work with multiple scenes in Unity",
      "MultiSceneEditing",
    ),
    manual(
      "Scene templates and saving",
      "Create scenes from templates",
      "scene-templates",
    ),
    manual(
      "Build process and callbacks",
      "Build applications with the Build Settings window",
      "BuildPlayerPipeline",
    ),
    api("SerializeField", "SerializeField", "SerializeField"),
    api("SerializeReference", "SerializeReference", "SerializeReference"),
    api(
      "ISerializationCallbackReceiver",
      "ISerializationCallbackReceiver",
      "ISerializationCallbackReceiver",
    ),
    api(
      "FormerlySerializedAsAttribute",
      "FormerlySerializedAsAttribute",
      "Serialization.FormerlySerializedAsAttribute",
    ),
    api("ScriptableObject", "ScriptableObject", "ScriptableObject"),
    api("AssetDatabase", "AssetDatabase", "AssetDatabase"),
    api("PrefabUtility", "PrefabUtility", "PrefabUtility"),
    api("SerializedObject", "SerializedObject", "SerializedObject"),
    api("SerializedProperty", "SerializedProperty", "SerializedProperty"),
    api("Undo", "Undo", "Undo"),
    api("Editor", "Editor", "Editor"),
    api("EditorWindow", "EditorWindow", "EditorWindow"),
    api("EditorGUILayout", "EditorGUILayout", "EditorGUILayout"),
    api("GUILayout", "GUILayout", "GUILayout"),
    api("CustomEditor", "CustomEditor", "CustomEditor"),
    api("CustomPropertyDrawer", "CustomPropertyDrawer", "CustomPropertyDrawer"),
    api("SceneView", "SceneView", "SceneView"),
    api("Selection", "Selection", "Selection"),
    api(
      "EditorSceneManager",
      "EditorSceneManager",
      "SceneManagement.EditorSceneManager",
    ),
    api("MenuItem", "MenuItem", "MenuItem"),
    api(
      "CompilationPipeline",
      "CompilationPipeline",
      "Compilation.CompilationPipeline",
    ),
    api(
      "IPreprocessBuildWithReport",
      "IPreprocessBuildWithReport",
      "Build.IPreprocessBuildWithReport",
    ),
    api(
      "IPostprocessBuildWithReport",
      "IPostprocessBuildWithReport",
      "Build.IPostprocessBuildWithReport",
    ),
  ],
};

const stage4: CoreStageSpec = {
  stage: 4,
  name: "Scenes, persistence, and data loading",
  verificationQueries: [
    "asynchronous scene loading AsyncOperation",
    "DontDestroyOnLoad persistent objects",
    "JsonUtility JSON serialization",
    "Application persistentDataPath",
  ],
  pages: [
    manual("Scene workflows", "Introduction to scenes", "CreatingScenes"),
    manual(
      "Scenes in builds",
      "Manage scenes in a build",
      "build-profile-scene-list",
    ),
    manual("JSON serialization", "JSON Serialization", "json-serialization"),
    manual(
      "Resources workflows",
      "Introduction to the Resources system",
      "LoadingResourcesatRuntime",
    ),
    api("SceneManager", "SceneManager", "SceneManagement.SceneManager"),
    api("Scene", "Scene", "SceneManagement.Scene"),
    api("LoadSceneMode", "LoadSceneMode", "SceneManagement.LoadSceneMode"),
    api(
      "SceneManager.LoadScene",
      "SceneManager.LoadScene",
      "SceneManagement.SceneManager.LoadScene",
    ),
    api(
      "SceneManager.LoadSceneAsync",
      "SceneManager.LoadSceneAsync",
      "SceneManagement.SceneManager.LoadSceneAsync",
    ),
    api(
      "SceneManager.UnloadSceneAsync",
      "SceneManager.UnloadSceneAsync",
      "SceneManagement.SceneManager.UnloadSceneAsync",
    ),
    api("AsyncOperation", "AsyncOperation", "AsyncOperation"),
    api(
      "DontDestroyOnLoad",
      "Object.DontDestroyOnLoad",
      "Object.DontDestroyOnLoad",
    ),
    api("Resources", "Resources", "Resources"),
    api("JsonUtility", "JsonUtility", "JsonUtility"),
    api("PlayerPrefs", "PlayerPrefs", "PlayerPrefs"),
    api(
      "Application.persistentDataPath",
      "Application.persistentDataPath",
      "Application-persistentDataPath",
    ),
  ],
};

const stage2: CoreStageSpec = {
  stage: 2,
  name: "Runtime lifecycle and object management",
  verificationQueries: [
    "event function lifecycle ordering runtime initialization",
    "FindObjectsByType GetComponent object lookup",
    "coroutine WaitForSeconds timing",
    "Object.Destroy destruction semantics",
  ],
  pages: [
    manual(
      "Event function execution order",
      "Event function execution order",
      "execution-order",
    ),
    manual("Per-frame updates", "Per-frame updates", "time-per-frame-updates"),
    manual(
      "Fixed timestep versus frame time",
      "Handling variation in time",
      "time-handling-variations",
    ),
    manual("Coroutines", "Write and run coroutines", "Coroutines"),
    manual(
      "Activating and deactivating objects",
      "Deactivate GameObjects",
      "DeactivatingGameObjects",
    ),
    manual(
      "Activating and deactivating components",
      "Manage components and their values",
      "InspectorManageComponents",
    ),
    manual("Managed memory", "Managed memory", "performance-managed-memory"),
    manual(
      "Garbage collection",
      "Garbage collector overview",
      "performance-garbage-collector",
    ),
    api("MonoBehaviour", "MonoBehaviour", "MonoBehaviour"),
    api("GameObject", "GameObject", "GameObject"),
    api("Component", "Component", "Component"),
    api("Transform", "Transform", "Transform"),
    api("Object.Instantiate", "Object.Instantiate", "Object.Instantiate"),
    api("Object.Destroy", "Object.Destroy", "Object.Destroy"),
    api(
      "Object.FindObjectsByType",
      "Object.FindObjectsByType",
      "Object.FindObjectsByType",
    ),
    api("GetComponent", "Component.GetComponent", "Component.GetComponent"),
    api(
      "GetComponentInChildren",
      "Component.GetComponentInChildren",
      "Component.GetComponentInChildren",
    ),
    api(
      "GetComponentInParent",
      "Component.GetComponentInParent",
      "Component.GetComponentInParent",
    ),
    api("GetComponents", "Component.GetComponents", "Component.GetComponents"),
    api("Time", "Time", "Time"),
    api("Coroutine", "Coroutine", "Coroutine"),
    api("WaitForSeconds", "WaitForSeconds", "WaitForSeconds"),
    api("WaitForFixedUpdate", "WaitForFixedUpdate", "WaitForFixedUpdate"),
    api(
      "RuntimeInitializeOnLoadMethodAttribute",
      "RuntimeInitializeOnLoadMethodAttribute",
      "RuntimeInitializeOnLoadMethodAttribute",
    ),
    api("Application", "Application", "Application"),
    api("Debug", "Debug", "Debug"),
  ],
};

const stage3: CoreStageSpec = {
  stage: 3,
  name: "3D physics",
  verificationQueries: [
    "Physics.Raycast RaycastHit",
    "OnTriggerEnter trigger callbacks",
    "LayerMask layer collision filtering QueryTriggerInteraction",
    "continuous collision detection mode",
    "Rigidbody movement MovePosition force",
  ],
  pages: [
    manual("Colliders", "Introduction to collision", "CollidersOverview"),
    manual("Triggers", "OnTrigger events", "collider-interactions-ontrigger"),
    manual(
      "Rigidbody physics",
      "Introduction to rigid body physics",
      "RigidbodiesOverview",
    ),
    manual(
      "Collision detection modes",
      "Choose a collision detection mode",
      "choose-collision-detection-mode",
    ),
    manual(
      "Continuous collision detection",
      "Continuous collision detection (CCD)",
      "ContinuousCollisionDetection",
    ),
    manual(
      "Physics queries and raycasts",
      "Optimize raycasts and other physics queries",
      "physics-optimization-raycasts-queries",
    ),
    manual(
      "Layer collision matrix",
      "Layer-based collision detection",
      "LayerBasedCollision",
    ),
    manual("FixedUpdate and physics timing", "Fixed updates", "fixed-updates"),
    manual(
      "Character controllers",
      "Introduction to character control",
      "CharacterControllers",
    ),
    api("Physics", "Physics", "Physics"),
    api("Collider", "Collider", "Collider"),
    api("Collision", "Collision", "Collision"),
    api("ContactPoint", "ContactPoint", "ContactPoint"),
    api("Rigidbody", "Rigidbody", "Rigidbody"),
    api("CharacterController", "CharacterController", "CharacterController"),
    api("RaycastHit", "RaycastHit", "RaycastHit"),
    api("LayerMask", "LayerMask", "LayerMask"),
    api(
      "QueryTriggerInteraction",
      "QueryTriggerInteraction",
      "QueryTriggerInteraction",
    ),
    api("ForceMode", "ForceMode", "ForceMode"),
    api(
      "Collision enter event",
      "Collider.OnCollisionEnter",
      "Collider.OnCollisionEnter",
    ),
    api(
      "Collision stay event",
      "Collider.OnCollisionStay",
      "Collider.OnCollisionStay",
    ),
    api(
      "Collision exit event",
      "Collider.OnCollisionExit",
      "Collider.OnCollisionExit",
    ),
    api(
      "Trigger enter event",
      "Collider.OnTriggerEnter",
      "Collider.OnTriggerEnter",
    ),
    api(
      "Trigger stay event",
      "Collider.OnTriggerStay",
      "Collider.OnTriggerStay",
    ),
    api(
      "Trigger exit event",
      "Collider.OnTriggerExit",
      "Collider.OnTriggerExit",
    ),
  ],
};

const stage5: CoreStageSpec = {
  stage: 5,
  name: "Rendering, audio, and UI fundamentals",
  verificationQueries: [
    "Renderer material sharedMaterial ownership instance",
    "camera callbacks beginCameraRendering onPreRender",
    "AudioMixer routing spatial audio",
    "RectTransform Canvas rebuild layout lifecycle",
  ],
  pages: [
    api("Renderer", "Renderer", "Renderer"),
    api("Material", "Material", "Material"),
    api("Shader", "Shader", "Shader"),
    api("Camera", "Camera", "Camera"),
    api("Bounds", "Bounds", "Bounds"),
    api("Color", "Color", "Color"),
    api("ParticleSystem", "ParticleSystem", "ParticleSystem"),
    api("AudioSource", "AudioSource", "AudioSource"),
    api("AudioClip", "AudioClip", "AudioClip"),
    api("AudioMixer", "AudioMixer", "Audio.AudioMixer"),
    api("Canvas", "Canvas", "Canvas"),
    api("RectTransform", "RectTransform", "RectTransform"),
    api("Renderer.material", "Renderer.material", "Renderer-material"),
    api(
      "Renderer.sharedMaterial",
      "Renderer.sharedMaterial",
      "Renderer-sharedMaterial",
    ),
    api(
      "Material instancing",
      "Material.enableInstancing",
      "Material-enableInstancing",
    ),
    manual("GPU instancing", "Introduction to GPU instancing", "GPUInstancing"),
    api("Camera pre-cull callback", "Camera.onPreCull", "Camera-onPreCull"),
    api(
      "Camera pre-render callback",
      "Camera.onPreRender",
      "Camera-onPreRender",
    ),
    api(
      "Camera post-render callback",
      "Camera.onPostRender",
      "Camera-onPostRender",
    ),
    api(
      "SRP begin-camera callback",
      "RenderPipelineManager.beginCameraRendering",
      "Rendering.RenderPipelineManager-beginCameraRendering",
    ),
    api(
      "SRP end-camera callback",
      "RenderPipelineManager.endCameraRendering",
      "Rendering.RenderPipelineManager-endCameraRendering",
    ),
    api(
      "Spatial audio",
      "AudioSource.spatialBlend",
      "AudioSource-spatialBlend",
    ),
    manual(
      "Audio mixer routing",
      "Introduction to the Audio Mixer",
      "AudioMixerOverview",
    ),
    manual("Spatial audio", "Audio Spatializer SDK", "AudioSpatializerSDK"),
    api(
      "Canvas rebuild",
      "Canvas.ForceUpdateCanvases",
      "Canvas.ForceUpdateCanvases",
    ),
    api(
      "Canvas pre-layout callback",
      "Canvas.preWillRenderCanvases",
      "Canvas-preWillRenderCanvases",
    ),
    api(
      "Canvas rebuild callback",
      "Canvas.willRenderCanvases",
      "Canvas-willRenderCanvases",
    ),
    api(
      "RectTransform calculation",
      "RectTransform.ForceUpdateRectTransforms",
      "RectTransform.ForceUpdateRectTransforms",
    ),
  ],
};

const stage6: CoreStageSpec = {
  stage: 6,
  name: "Performance and diagnostics",
  verificationQueries: [
    "tracking garbage collection allocations diagnosis",
    "draw calls batching GPU instancing",
    "physics performance CPU cost",
    "target platform Player profiling versus Editor",
  ],
  pages: [
    manual("Unity Profiler", "Profiler introduction", "profiler-introduction"),
    manual("Profiler window", "Profiler window reference", "ProfilerWindow"),
    manual(
      "Collect performance data",
      "Collecting performance data",
      "profiler-profiling-applications",
    ),
    manual(
      "Player profiling",
      "Collect performance data on a target platform",
      "profiling-target-device",
    ),
    manual(
      "Editor profiling",
      "Collect performance data about the Unity Editor",
      "profiling-edit-mode",
    ),
    manual(
      "Play Mode profiling",
      "Collect performance data in Play mode",
      "profiling-play-mode",
    ),
    manual(
      "Managed object lifetime",
      "Managed memory introduction",
      "performance-managed-memory-introduction",
    ),
    manual(
      "GC allocations",
      "Tracking garbage collection allocations",
      "performance-track-garbage-collection",
    ),
    manual(
      "Optimize managed allocations",
      "Optimizing your code for managed memory",
      "performance-optimizing-code-managed-memory",
    ),
    manual(
      "Physics performance",
      "Understand physics performance issues",
      "physics-performance-issues",
    ),
    manual(
      "Physics optimization",
      "Optimize physics performance",
      "physics-optimization",
    ),
    manual(
      "Physics CPU cost",
      "Optimize the physics system for CPU usage",
      "physics-optimization-cpu",
    ),
    manual(
      "Draw calls",
      "Introduction to optimizing draw calls",
      "optimizing-draw-calls",
    ),
    manual("Batching", "Introduction to batching meshes", "DrawCallBatching"),
    manual(
      "Profile Analyzer",
      "Profile Analyzer",
      "com.unity.performance.profile-analyzer",
    ),
  ],
};

export const CORE_STAGES: CoreStageSpec[] = [
  stage1,
  stage2,
  stage3,
  stage4,
  stage5,
  stage6,
];

export function getCoreStage(stage: UnityCoreStage) {
  const spec = CORE_STAGES.find((candidate) => candidate.stage === stage);
  if (!spec)
    throw new Error(
      `No targeted Unity core manifest is defined for stage ${stage}.`,
    );
  return spec;
}

export function validateCoreManifest() {
  const urls = new Map<string, UnityCoreStage>();
  let total = 0;
  for (const stage of CORE_STAGES) {
    if (stage.pages.length > 50)
      throw new Error(
        `Stage ${stage.stage} unexpectedly contains ${stage.pages.length} pages (limit: 50).`,
      );
    for (const page of stage.pages) {
      total++;
      const key = `${page.kind}:${page.slug}`;
      const previous = urls.get(key);
      if (previous)
        throw new Error(
          `Duplicate core page ${key} in stages ${previous} and ${stage.stage}.`,
        );
      urls.set(key, stage.stage);
    }
  }
  if (total > 200)
    throw new Error(
      `Targeted Unity core corpus unexpectedly contains ${total} pages (limit: 200).`,
    );
  return { stages: CORE_STAGES.length, pages: total };
}
