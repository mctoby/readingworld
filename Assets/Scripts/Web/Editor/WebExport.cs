using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using Unity.Cinemachine;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;
using UnityEngine.Splines;
using UnityEngine.UI;
using TMPro;

/// <summary>
/// Tools > Reading World > Export for Web: writes everything the three.js version (web/) needs into
/// web/export: the scenery and props as GLB files, the collision shapes, and world.json with the
/// gameplay setup (NPCs, quests, cameras, lighting, crates...). Dialogue and audio are copied too.
/// The web project's `npm run assets` (run automatically by dev and build) then compresses these into
/// web/public/game. Re-run it whenever the Unity scenes change. Nothing in the Unity scenes is saved or changed.
/// </summary>
static class WebExport
{
    const string Folder = "Assets/Scenes/World/";

    // Raw export. web/scripts/build-assets.mjs turns it into the optimised files the game loads (web/public/game).
    static string Root => Path.GetFullPath(Path.Combine(Application.dataPath, "..", "web", "export"));

    // ---------------------------------------------------------------- data written to world.json

    [Serializable] class Xform { public Vector3 position; public Quaternion rotation; public Vector3 scale = Vector3.one; }

    [Serializable] class Lens { public float fov = 60; public float near = 0.3f; public float far = 1000; }

    [Serializable]
    class Cam
    {
        public string id, name;
        public Xform xform;
        public int priority;
        public bool enabled;      // enabled and active in the scene at start
        public Lens lens = new();
        public string tracking;   // "player" if it follows / looks at the player
        public bool composer; public Vector3 composerOffset; public Vector2 composerDamping;
        public bool followZoom; public float zoomWidth, zoomDamping; public Vector2 zoomFovRange;
        public bool dolly; public Vector3[] splinePoints; public bool splineClosed; public Vector3 dollyOffset; public float dollyPosition;
        public bool follow; public Vector3 followOffset;
    }

    [Serializable] class Zone { public string name; public Xform xform; public Vector3 center, size; public string camera; }

    [Serializable]
    class Npc
    {
        public string id, node, npcId, name;
        public Xform xform;
        public string[] dialogue = new string[3];
        public string unlockedByQuest;
        public string[] questObjects;
        public float interactRange;
        public Xform model;           // the Chip model under the NPC (local)
        public Xform dialogueCamera;  // world
        public Lens dialogueLens = new();
        public string chatIcon;
        public float capsuleRadius = 0.25f, capsuleHeight = 1f; public Vector3 capsuleCenter;
        public Color bodyColor = Color.white;   // each NPC's Chip has its own body material
    }

    [Serializable] class Collect { public string node, itemId; public float spinSpeed, bobHeight, bobSpeed, collectDuration, collectRise; public Vector3 boxCenter, boxSize; }

    [Serializable] class Crate { public string node; public float stepSize, pushDelay, slideTime; public Vector3 boxCenter, boxSize; }

    [Serializable]
    class Library
    {
        public string node; public Xform xform; public string[] books; public string questId;
        public int cameraSide; public float framingPadding, cameraElevation, revealInterval, slideDistance, slideDuration, holdTime;
        public Lens lens = new();
    }

    [Serializable]
    class Player
    {
        public Xform xform; public Xform model;
        public float moveSpeed, sprintSpeed, rotationSmoothTime, speedChangeRate, jumpHeight, gravity, jumpTimeout, fallTimeout;
        public float height, radius, stepOffset, slopeLimit; public Vector3 center;
        public string[] footsteps; public string landing; public float footstepVolume;
        public float bendRadius, bendStrength, bendHeight, bendSway, bendSwaySpeed, bendSmoothing;
    }

    [Serializable]
    class Lighting
    {
        public string scene;
        public Color lightColor; public float lightIntensity; public Quaternion lightRotation; public float shadowStrength;
        public bool flare;
        public string ambientMode; public Color ambientSky, ambientEquator, ambientGround; public float ambientIntensity;
        public bool fog; public string fogMode; public Color fogColor; public float fogDensity, fogStart, fogEnd;
        public string skybox; public Color skyTint; public float skyExposure, skyRotation;
        public Color shadowColor;
        public string music; public float musicVolume;
        public string[] post;   // raw JSON of each volume override, for the web version to pick from
    }

    [Serializable] class DayFiles { public string npcId; public string[] files = new string[3]; }
    [Serializable] class DayInfo { public int day; public string topic; public bool live; public string timeOfDay; public List<DayFiles> npcs = new(); }

    [Serializable]
    class World
    {
        public string exportedAt;
        public Player player;
        public List<Npc> npcs = new();
        public string[] placerNpcs; public Vector3[] locators; public float placerHeight; public int placerSalt; public bool placerUseRotation;
        public List<Collect> collectables = new();
        public List<Crate> crates = new();
        public Library library;
        public List<Cam> cameras = new();
        public List<Zone> zones = new();
        public float blendTime = 1f;
        public List<Lighting> lighting = new();
        public string day1TimeOfDay; public List<DayInfo> days = new();
        public string[] bendNodes;
        public string[] colliderNodes;
        public string glossary;
        public string typingSound, questSound;
    }

    // ---------------------------------------------------------------- export

    static readonly Dictionary<GameObject, string> renamed = new();
    static int nextId;
    static readonly HashSet<string> copied = new();

    [MenuItem("Tools/Reading World/Export for Web (three.js)", priority = 200)]
    static async void Export()
    {
        if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;
        try { await Run(); }
        catch (Exception e) { Debug.LogException(e); }
        finally
        {
            EditorUtility.ClearProgressBar();
            // Put the scenes back exactly as they were on disk (export renames objects temporarily).
            Reopen();
        }
    }

    static void Reopen()
    {
        var c = DailyContent.Instance;
        EditorSceneManager.OpenScene(Folder + c.environmentScene + ".unity", OpenSceneMode.Single);
        var lighting = EditorSceneManager.OpenScene(Folder + c.dayLightingScene + ".unity", OpenSceneMode.Additive);
        EditorSceneManager.OpenScene(Folder + c.coreScene + ".unity", OpenSceneMode.Additive);
        SceneManager.SetActiveScene(lighting);
        BakedLightingSet.ApplyActive();
    }

    static async Task Run()
    {
        renamed.Clear(); copied.Clear(); nextId = 0;
        var c = DailyContent.Instance;
        Directory.CreateDirectory(Root);
        foreach (var sub in new[] { "models", "dialogue", "audio", "textures" }) Directory.CreateDirectory(Path.Combine(Root, sub));

        var env = EditorSceneManager.OpenScene(Folder + c.environmentScene + ".unity", OpenSceneMode.Single);
        var day = EditorSceneManager.OpenScene(Folder + c.dayLightingScene + ".unity", OpenSceneMode.Additive);
        var night = EditorSceneManager.OpenScene(Folder + c.nightLightingScene + ".unity", OpenSceneMode.Additive);
        var core = EditorSceneManager.OpenScene(Folder + c.coreScene + ".unity", OpenSceneMode.Additive);

        var world = new World { exportedAt = DateTime.Now.ToString("yyyy-MM-dd HH:mm") };

        EditorUtility.DisplayProgressBar("Export for Web", "Gameplay data", 0.1f);
        ExportPlayer(core, world);
        ExportNpcs(core, world);
        ExportPlacer(core, world);
        ExportCollectables(core, world);
        ExportCrates(core, world);
        ExportLibrary(core, world);
        ExportCameras(core, world);
        ExportUiSounds(core, world);
        ExportDays(c, world);
        world.glossary = CopyAsset(AssetDatabase.GUIDToAssetPath(AssetDatabase.FindAssets("GlossaryDefinitions t:TextAsset")[0]), "dialogue");

        foreach (var s in new[] { day, night })
        {
            SceneManager.SetActiveScene(s);
            world.lighting.Add(ExportLighting(s));
        }
        SceneManager.SetActiveScene(day);

        // Plants and mushrooms that bend away from the player.
        var bend = new List<string>();
        foreach (var root in env.GetRootGameObjects())
        foreach (var r in root.GetComponentsInChildren<MeshRenderer>(true))
            if (r.sharedMaterial != null && r.sharedMaterial.shader.name.Contains("Soft Bend")) bend.Add(Id(r.gameObject));
        world.bendNodes = bend.ToArray();

        // ---- Models
        EditorUtility.DisplayProgressBar("Export for Web", "Environment model", 0.3f);
        await Glb("environment", Active(env.GetRootGameObjects()));

        EditorUtility.DisplayProgressBar("Export for Web", "Props model", 0.5f);
        var props = new List<GameObject>();
        var hidden = new List<GameObject>();
        foreach (var root in core.GetRootGameObjects())
        {
            if (!root.activeInHierarchy) continue;
            if (root.GetComponent<NPCInteractable>() || root.GetComponent<LibraryManager>() || root.GetComponent<PushCrate>() || root.name == "QuestBooks")
                props.Add(root);
        }
        // The characters are exported separately (models/chip.glb); hide them here.
        foreach (var root in props)
        foreach (var a in root.GetComponentsInChildren<Animator>(true))
            if (a.gameObject.activeSelf) { a.gameObject.SetActive(false); hidden.Add(a.gameObject); }
        await Glb("props", props.ToArray());
        foreach (var h in hidden) h.SetActive(true);

        // The character (player and NPCs all use it), at the origin with no scale: world.json has each one's placement.
        EditorUtility.DisplayProgressBar("Export for Web", "Character model", 0.6f);
        var chip = GameObject.FindGameObjectWithTag("Player").GetComponentInChildren<Animator>(true).gameObject;
        chip.transform.SetParent(null, false);
        chip.transform.SetPositionAndRotation(Vector3.zero, Quaternion.identity);
        chip.transform.localScale = Vector3.one;
        await Glb("chip", new[] { chip });

        EditorUtility.DisplayProgressBar("Export for Web", "Collision shapes", 0.7f);
        world.colliderNodes = await ExportColliders(env, core);

        File.WriteAllText(Path.Combine(Root, "world.json"), JsonUtility.ToJson(world, true));
        Debug.Log($"Exported the world for the web to {Root}. In web/, `npm run dev` or `npm run build` will compress it.");
    }

    static GameObject[] Active(GameObject[] roots) => Array.FindAll(roots, r => r.activeInHierarchy);

    /// <summary>Gives the object a name that is unique in the export ("Book#12"), so the web version can find it.</summary>
    static string Id(GameObject go)
    {
        if (go == null) return null;
        if (renamed.TryGetValue(go, out var id)) return id;
        id = go.name.Replace("#", "") + "#" + (++nextId);
        renamed[go] = id;
        go.name = id;
        return id;
    }

    static Xform WorldOf(Transform t) => new() { position = t.position, rotation = t.rotation, scale = t.lossyScale };
    static Xform Local(Transform t) => new() { position = t.localPosition, rotation = t.localRotation, scale = t.localScale };

    static GameObject Find(Scene s, Func<GameObject, bool> match)
    {
        foreach (var root in s.GetRootGameObjects())
        foreach (var t in root.GetComponentsInChildren<Transform>(true))
            if (match(t.gameObject)) return t.gameObject;
        return null;
    }

    static T Get<T>(SerializedObject so, string prop) where T : UnityEngine.Object =>
        so.FindProperty(prop)?.objectReferenceValue as T;

    // ---------------------------------------------------------------- gameplay

    static void ExportPlayer(Scene core, World world)
    {
        var go = GameObject.FindGameObjectWithTag("Player");
        var tpc = go.GetComponent("ThirdPersonController");
        var so = new SerializedObject(tpc);
        float F(string n) => so.FindProperty(n).floatValue;
        var cc = go.GetComponent<CharacterController>();
        var model = go.GetComponentInChildren<Animator>(true);

        var feet = new List<string>();
        var clips = so.FindProperty("FootstepAudioClips");
        for (int i = 0; i < clips.arraySize; i++) feet.Add(CopyAsset(clips.GetArrayElementAtIndex(i).objectReferenceValue, "audio"));

        var bend = new SerializedObject(go.GetComponent<SoftBendPlayer>());
        float B(string n) => bend.FindProperty(n).floatValue;

        world.player = new Player
        {
            xform = WorldOf(go.transform),
            model = model != null ? Local(model.transform) : null,
            moveSpeed = F("MoveSpeed"), sprintSpeed = F("SprintSpeed"), rotationSmoothTime = F("RotationSmoothTime"),
            speedChangeRate = F("SpeedChangeRate"), jumpHeight = F("JumpHeight"), gravity = F("Gravity"),
            jumpTimeout = F("JumpTimeout"), fallTimeout = F("FallTimeout"),
            height = cc.height, radius = cc.radius, center = cc.center, stepOffset = cc.stepOffset, slopeLimit = cc.slopeLimit,
            footsteps = feet.ToArray(), landing = CopyAsset(so.FindProperty("LandingAudioClip").objectReferenceValue, "audio"),
            footstepVolume = F("FootstepAudioVolume"),
            bendRadius = B("radius"), bendStrength = B("strength"), bendHeight = B("bendHeight"),
            bendSway = B("sway"), bendSwaySpeed = B("swaySpeed"), bendSmoothing = B("smoothing"),
        };
    }

    static void ExportNpcs(Scene core, World world)
    {
        foreach (var root in core.GetRootGameObjects())
        foreach (var npc in root.GetComponentsInChildren<NPCInteractable>(true))
        {
            var so = new SerializedObject(npc);
            var n = new Npc
            {
                node = Id(npc.gameObject),
                npcId = so.FindProperty("npcId").stringValue,
                xform = WorldOf(npc.transform),
                unlockedByQuest = so.FindProperty("unlockedByQuest").stringValue,
                interactRange = so.FindProperty("interactRange").floatValue,
            };
            n.id = string.IsNullOrEmpty(n.npcId) ? npc.name.ToLowerInvariant() : n.npcId;
            var levels = new[] { "dialogueAges5to8", "dialogueAges8to11", "dialogueAges12to15" };
            for (int i = 0; i < 3; i++) n.dialogue[i] = CopyAsset(so.FindProperty(levels[i]).objectReferenceValue, "dialogue");
            var first = Array.Find(n.dialogue, d => d != null);
            if (first != null)
            {
                var data = JsonUtility.FromJson<DialogueData>(File.ReadAllText(Path.Combine(Root, first)));
                n.name = data.npcName;
            }

            var objs = so.FindProperty("questObjects");
            n.questObjects = new string[objs.arraySize];
            for (int i = 0; i < objs.arraySize; i++) n.questObjects[i] = Id(objs.GetArrayElementAtIndex(i).objectReferenceValue as GameObject);

            var model = npc.GetComponentInChildren<Animator>(true);
            if (model != null) n.model = Local(model.transform);
            foreach (var smr in npc.GetComponentsInChildren<SkinnedMeshRenderer>(true))
                if (smr.name == "Chip_Retopo" && smr.sharedMaterial != null && smr.sharedMaterial.HasProperty("_BaseColor"))
                    n.bodyColor = smr.sharedMaterial.GetColor("_BaseColor");

            var cam = Get<GameObject>(so, "dialogueCamera");
            if (cam == null) { var cm = npc.GetComponentInChildren<CinemachineCamera>(true); if (cm != null) cam = cm.gameObject; }
            if (cam != null)
            {
                n.dialogueCamera = WorldOf(cam.transform);
                var cm = cam.GetComponent<CinemachineCamera>();
                if (cm != null) n.dialogueLens = LensOf(cm);
            }

            var icon = Get<GameObject>(so, "talkIcon");
            if (icon == null) { var t = npc.transform.Find("ChatIcon"); if (t != null) icon = t.gameObject; }
            n.chatIcon = Id(icon);

            var cap = npc.GetComponent<CapsuleCollider>();
            if (cap != null) { n.capsuleRadius = cap.radius * npc.transform.lossyScale.x; n.capsuleHeight = cap.height * npc.transform.lossyScale.y; n.capsuleCenter = Vector3.Scale(cap.center, npc.transform.lossyScale); }
            world.npcs.Add(n);
        }
    }

    static void ExportPlacer(Scene core, World world)
    {
        var go = Find(core, g => g.GetComponent<NPCPlacer>());
        if (go == null) return;
        var so = new SerializedObject(go.GetComponent<NPCPlacer>());
        var npcs = so.FindProperty("npcs");
        world.placerNpcs = new string[npcs.arraySize];
        for (int i = 0; i < npcs.arraySize; i++)
        {
            var t = npcs.GetArrayElementAtIndex(i).objectReferenceValue as Transform;
            world.placerNpcs[i] = t != null ? t.GetComponent<NPCInteractable>() is var ni && ni != null ? new SerializedObject(ni).FindProperty("npcId").stringValue : t.name : null;
        }
        var spots = new List<Vector3>();
        foreach (Transform child in go.transform) spots.Add(child.position);
        world.locators = spots.ToArray();
        world.placerHeight = so.FindProperty("heightOffset").floatValue;
        world.placerSalt = so.FindProperty("seedSalt").intValue;
        world.placerUseRotation = so.FindProperty("useLocatorRotation").boolValue;
    }

    static void ExportCollectables(Scene core, World world)
    {
        foreach (var root in core.GetRootGameObjects())
        foreach (var col in root.GetComponentsInChildren<Collectable>(true))
        {
            var so = new SerializedObject(col);
            var box = col.GetComponent<BoxCollider>();
            world.collectables.Add(new Collect
            {
                node = Id(col.gameObject), itemId = so.FindProperty("itemId").stringValue,
                spinSpeed = so.FindProperty("spinSpeed").floatValue, bobHeight = so.FindProperty("bobHeight").floatValue,
                bobSpeed = so.FindProperty("bobSpeed").floatValue, collectDuration = so.FindProperty("collectDuration").floatValue,
                collectRise = so.FindProperty("collectRise").floatValue,
                boxCenter = box ? box.center : Vector3.zero, boxSize = box ? box.size : Vector3.one * 0.3f,
            });
        }
    }

    static void ExportCrates(Scene core, World world)
    {
        foreach (var root in core.GetRootGameObjects())
        foreach (var crate in root.GetComponentsInChildren<PushCrate>(true))
        {
            var so = new SerializedObject(crate);
            var box = crate.GetComponent<BoxCollider>();
            world.crates.Add(new Crate
            {
                node = Id(crate.gameObject), stepSize = so.FindProperty("stepSize").floatValue,
                pushDelay = so.FindProperty("pushDelay").floatValue, slideTime = so.FindProperty("slideTime").floatValue,
                boxCenter = box ? box.center : Vector3.up * 0.25f, boxSize = box ? Vector3.Scale(box.size, crate.transform.lossyScale) : Vector3.one * 0.5f,
            });
        }
    }

    static void ExportLibrary(Scene core, World world)
    {
        var go = Find(core, g => g.GetComponent<LibraryManager>());
        if (go == null) return;
        var lm = go.GetComponent<LibraryManager>();
        var so = new SerializedObject(lm);
        var books = new List<string>();
        var list = so.FindProperty("books");
        for (int i = 0; i < list.arraySize; i++) books.Add(Id(list.GetArrayElementAtIndex(i).objectReferenceValue as GameObject));
        if (books.Count == 0)
            foreach (Transform child in go.transform)
                if (child.name == "Book" || child.name.StartsWith("Book (")) books.Add(Id(child.gameObject));

        var cam = Get<CinemachineCamera>(so, "libraryCamera");
        world.library = new Library
        {
            node = Id(go), xform = WorldOf(go.transform), books = books.ToArray(), questId = so.FindProperty("questId").stringValue,
            cameraSide = so.FindProperty("cameraSide").intValue, framingPadding = so.FindProperty("framingPadding").floatValue,
            cameraElevation = so.FindProperty("cameraElevation").floatValue, revealInterval = so.FindProperty("revealInterval").floatValue,
            slideDistance = so.FindProperty("slideDistance").floatValue, slideDuration = so.FindProperty("slideDuration").floatValue,
            holdTime = so.FindProperty("holdTime").floatValue, lens = cam != null ? LensOf(cam) : new Lens { fov = 40 },
        };
    }

    static Lens LensOf(CinemachineCamera cm) => new() { fov = cm.Lens.FieldOfView, near = cm.Lens.NearClipPlane, far = cm.Lens.FarClipPlane };

    static void ExportCameras(Scene core, World world)
    {
        var brain = Find(core, g => g.GetComponent<CinemachineBrain>() && g.activeInHierarchy)?.GetComponent<CinemachineBrain>();
        if (brain != null) world.blendTime = brain.DefaultBlend.Time;

        foreach (var root in core.GetRootGameObjects())
        {
            if (!root.activeInHierarchy) continue;
            if (root.GetComponent<NPCInteractable>() || root.GetComponent<LibraryManager>()) continue;   // their own cameras
            foreach (var cm in root.GetComponentsInChildren<CinemachineCamera>(true))
            {
                var cam = new Cam
                {
                    id = Id(cm.gameObject), name = cm.name, xform = WorldOf(cm.transform), priority = cm.Priority.Value,
                    enabled = cm.enabled && cm.gameObject.activeInHierarchy, lens = LensOf(cm),
                    tracking = cm.Target.TrackingTarget != null || cm.Target.LookAtTarget != null ? "player" : null,
                };
                var comp = cm.GetComponent<CinemachineRotationComposer>();
                if (comp != null && comp.enabled) { cam.composer = true; cam.composerOffset = comp.TargetOffset; cam.composerDamping = comp.Damping; }
                var zoom = cm.GetComponent<CinemachineFollowZoom>();
                if (zoom != null && zoom.enabled) { cam.followZoom = true; cam.zoomWidth = zoom.Width; cam.zoomDamping = zoom.Damping; cam.zoomFovRange = zoom.FovRange; }
                var follow = cm.GetComponent<CinemachineFollow>();
                if (follow != null && follow.enabled) { cam.follow = true; cam.followOffset = follow.FollowOffset; }
                var dolly = cm.GetComponent<CinemachineSplineDolly>();
                if (dolly != null && dolly.enabled && dolly.Spline != null)
                {
                    cam.dolly = true;
                    cam.dollyOffset = dolly.SplineOffset;
                    cam.dollyPosition = dolly.CameraPosition;
                    var container = dolly.Spline;
                    var pts = new List<Vector3>();
                    var spline = container.Spline;
                    const int samples = 64;
                    for (int i = 0; i <= samples; i++)
                        pts.Add(container.transform.TransformPoint((Vector3)spline.EvaluatePosition(i / (float)samples)));
                    cam.splinePoints = pts.ToArray();
                    cam.splineClosed = spline.Closed;
                }
                world.cameras.Add(cam);

                // A trigger zone above this camera turns it on while the player is inside.
                var zoneGo = cm.transform.parent != null ? cm.transform.parent.gameObject : null;
                var trig = zoneGo != null ? zoneGo.GetComponent<BoxTriggerDetection>() : null;
                var box = zoneGo != null ? zoneGo.GetComponent<BoxCollider>() : null;
                if (trig != null && box != null)
                    world.zones.Add(new Zone { name = zoneGo.name, xform = WorldOf(zoneGo.transform), center = box.center, size = box.size, camera = cam.id });
            }
        }
    }

    static void ExportUiSounds(Scene core, World world)
    {
        var body = Find(core, g => g.name == "Body" && g.GetComponent<AudioSource>());
        if (body != null) world.typingSound = CopyAsset(body.GetComponent<AudioSource>().clip, "audio");
        var hud = Find(core, g => g.name == "QuestHud" && g.GetComponent<AudioSource>());
        if (hud != null) world.questSound = CopyAsset(hud.GetComponent<AudioSource>().clip, "audio");
    }

    static void ExportDays(DailyContent c, World world)
    {
        world.day1TimeOfDay = c.day1TimeOfDay.ToString();
        foreach (var d in c.days)
        {
            var info = new DayInfo { day = d.day, topic = d.topic, live = d.live, timeOfDay = d.timeOfDay.ToString() };
            foreach (var n in d.npcs)
            {
                var files = new DayFiles { npcId = n.npcId };
                var all = n.All;
                for (int i = 0; i < 3; i++) files.files[i] = CopyAsset(all[i], "dialogue/days");
                info.npcs.Add(files);
            }
            world.days.Add(info);
        }
    }

    static Lighting ExportLighting(Scene s)
    {
        var l = new Lighting { scene = s.name };
        foreach (var root in s.GetRootGameObjects())
        {
            foreach (var light in root.GetComponentsInChildren<Light>(true))
            {
                if (light.type != LightType.Directional) continue;
                l.lightColor = light.color; l.lightIntensity = light.intensity; l.lightRotation = light.transform.rotation;
                l.shadowStrength = light.shadowStrength;
                l.flare = light.GetComponent<LensFlareComponentSRP>() is var f && f != null && f.enabled;
            }
            foreach (var vol in root.GetComponentsInChildren<Volume>(true))
            {
                if (!vol.isGlobal || vol.sharedProfile == null) continue;
                var post = new List<string>();
                foreach (var comp in vol.sharedProfile.components)
                    if (comp.active) post.Add("{\"type\":\"" + comp.GetType().Name + "\",\"data\":" + EditorJsonUtility.ToJson(comp) + "}");
                l.post = post.ToArray();
            }
            foreach (var src in root.GetComponentsInChildren<AudioSource>(true))
                if (src.clip != null && src.loop) { l.music = CopyAsset(src.clip, "audio"); l.musicVolume = src.volume; }
        }
        l.ambientMode = RenderSettings.ambientMode.ToString();
        l.ambientSky = RenderSettings.ambientSkyColor; l.ambientEquator = RenderSettings.ambientEquatorColor; l.ambientGround = RenderSettings.ambientGroundColor;
        l.ambientIntensity = RenderSettings.ambientIntensity;
        l.fog = RenderSettings.fog; l.fogMode = RenderSettings.fogMode.ToString(); l.fogColor = RenderSettings.fogColor;
        l.fogDensity = RenderSettings.fogDensity; l.fogStart = RenderSettings.fogStartDistance; l.fogEnd = RenderSettings.fogEndDistance;
        l.shadowColor = RenderSettings.subtractiveShadowColor;
        var sky = RenderSettings.skybox;
        if (sky != null)
        {
            var tex = sky.HasProperty("_MainTex") ? sky.GetTexture("_MainTex") : null;
            l.skybox = tex != null ? CopyTexture(tex, s.name + "_sky") : null;
            l.skyTint = sky.HasProperty("_Tint") ? sky.GetColor("_Tint") : Color.white;
            l.skyExposure = sky.HasProperty("_Exposure") ? sky.GetFloat("_Exposure") : 1f;
            l.skyRotation = sky.HasProperty("_Rotation") ? sky.GetFloat("_Rotation") : 0f;
        }
        return l;
    }

    // ---------------------------------------------------------------- files

    /// <summary>Copies an asset (dialogue, audio...) into web/public/game/sub and returns its path there.</summary>
    static string CopyAsset(UnityEngine.Object asset, string sub) => asset == null ? null : CopyAsset(AssetDatabase.GetAssetPath(asset), sub);

    static string CopyAsset(string assetPath, string sub)
    {
        if (string.IsNullOrEmpty(assetPath)) return null;
        string rel = sub + "/" + Path.GetFileName(assetPath);
        if (copied.Add(rel))
        {
            Directory.CreateDirectory(Path.Combine(Root, sub));
            File.Copy(Path.GetFullPath(assetPath), Path.Combine(Root, rel), true);
        }
        return rel;
    }

    /// <summary>Writes a texture as a PNG (works for any source format, e.g. a skybox EXR).</summary>
    static string CopyTexture(Texture tex, string name)
    {
        string rel = "textures/" + name + ".png";
        var rt = RenderTexture.GetTemporary(tex.width, tex.height, 0, RenderTextureFormat.ARGB32, RenderTextureReadWrite.sRGB);
        Graphics.Blit(tex, rt);
        var prev = RenderTexture.active;
        RenderTexture.active = rt;
        var copy = new Texture2D(tex.width, tex.height, TextureFormat.RGBA32, false);
        copy.ReadPixels(new Rect(0, 0, tex.width, tex.height), 0, 0);
        copy.Apply();
        RenderTexture.active = prev;
        RenderTexture.ReleaseTemporary(rt);
        File.WriteAllBytes(Path.Combine(Root, rel), copy.EncodeToPNG());
        UnityEngine.Object.DestroyImmediate(copy);
        return rel;
    }


    static async Task Glb(string name, GameObject[] roots)
    {
        // glTFast's assemblies can't be referenced from the default editor assembly, so it is driven by reflection.
        Type T(string n) => Type.GetType("GLTFast.Export." + n + ", glTFast.Export") ?? Type.GetType("GLTFast." + n + ", glTFast")
            ?? throw new Exception("glTFast (com.unity.cloud.gltfast) is needed for Export for Web: " + n);
        object E(string type, string value) => Enum.Parse(T(type), value);

        var settingsType = T("ExportSettings");
        var settings = Activator.CreateInstance(settingsType);
        settingsType.GetProperty("Format").SetValue(settings, E("GltfFormat", "Binary"));
        settingsType.GetProperty("ComponentMask").SetValue(settings, E("ComponentType", "Mesh"));
        settingsType.GetProperty("ImageDestination").SetValue(settings, E("ImageDestination", "MainBuffer"));
        settingsType.GetProperty("FileConflictResolution").SetValue(settings, E("FileConflictResolution", "Overwrite"));

        var exportType = T("GameObjectExport");
        var ctor = Array.Find(exportType.GetConstructors(), c => c.GetParameters().Length > 0 && c.GetParameters()[0].ParameterType == settingsType);
        var args = new object[ctor.GetParameters().Length];
        args[0] = settings;
        for (int i = 1; i < args.Length; i++) args[i] = ctor.GetParameters()[i].HasDefaultValue ? ctor.GetParameters()[i].DefaultValue : null;
        var export = ctor.Invoke(args);

        exportType.GetMethod("AddScene", new[] { typeof(GameObject[]), typeof(string) }).Invoke(export, new object[] { roots, name });
        var save = exportType.GetMethod("SaveToFileAndDispose");
        var task = (Task<bool>)save.Invoke(export, new object[] { Path.Combine(Root, "models", name + ".glb"), default(System.Threading.CancellationToken) });
        bool ok = await task;
        if (!ok) Debug.LogError($"Export for Web: {name}.glb failed.");
    }

    /// <summary>Solid colliders (not triggers, not crates or NPCs, which move) as plain meshes, for the web physics.</summary>
    static async Task<string[]> ExportColliders(Scene env, Scene core)
    {
        var temp = new GameObject("Colliders");
        var names = new List<string>();
        var cube = Resources.GetBuiltinResource<Mesh>("Cube.fbx");
        var mat = new Material(Shader.Find("Universal Render Pipeline/Lit"));
        int n = 0;

        void Add(Mesh mesh, Matrix4x4 m)
        {
            var go = new GameObject("col" + (n++));
            go.transform.SetParent(temp.transform, false);
            go.transform.position = m.GetColumn(3);
            go.transform.rotation = m.rotation;
            go.transform.localScale = m.lossyScale;
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            go.AddComponent<MeshRenderer>().sharedMaterial = mat;
            names.Add(go.name);
        }

        foreach (var s in new[] { env, core })
        foreach (var root in s.GetRootGameObjects())
        {
            if (!root.activeInHierarchy || root.CompareTag("Player")) continue;
            foreach (var col in root.GetComponentsInChildren<Collider>(false))
            {
                if (!col.enabled || col.isTrigger) continue;
                if (col.GetComponentInParent<PushCrate>() || col.GetComponentInParent<NPCInteractable>() || col.GetComponentInParent<Collectable>()) continue;
                var t = col.transform;
                switch (col)
                {
                    case BoxCollider b:
                        Add(cube, t.localToWorldMatrix * Matrix4x4.TRS(b.center, Quaternion.identity, b.size));
                        break;
                    case MeshCollider mc when mc.sharedMesh != null:
                        Add(mc.sharedMesh, t.localToWorldMatrix);
                        break;
                    case SphereCollider sc:
                        Add(cube, t.localToWorldMatrix * Matrix4x4.TRS(sc.center, Quaternion.identity, Vector3.one * sc.radius * 1.6f));
                        break;
                    case CapsuleCollider cap:
                        var size = new Vector3(cap.radius * 2, cap.height, cap.radius * 2);
                        if (cap.direction == 0) size = new Vector3(cap.height, cap.radius * 2, cap.radius * 2);
                        if (cap.direction == 2) size = new Vector3(cap.radius * 2, cap.radius * 2, cap.height);
                        Add(cube, t.localToWorldMatrix * Matrix4x4.TRS(cap.center, Quaternion.identity, size));
                        break;
                }
            }
        }
        await Glb("colliders", new[] { temp });
        UnityEngine.Object.DestroyImmediate(temp);
        UnityEngine.Object.DestroyImmediate(mat);
        return names.ToArray();
    }
}
