using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

/// <summary>
/// Opening and baking the split world (Core + Environment + Lighting_Day / Lighting_Night).
/// Unity keeps one bake per scene, so each bake is captured into the lighting scene's BakedLightingSet and the
/// Environment and Core scenes keep no lighting data of their own.
/// </summary>
static class WorldScenesMenu
{
    const string Folder = "Assets/Scenes/World/";

    static DailyContent Content => DailyContent.Instance;

    static string PathOf(string sceneName) => Folder + sceneName + ".unity";

    [MenuItem("Tools/Reading World/Open World (Day)", priority = 100)]
    static void OpenDay() => Open(Content.dayLightingScene);

    [MenuItem("Tools/Reading World/Open World (Night)", priority = 101)]
    static void OpenNight() => Open(Content.nightLightingScene);

    /// <summary>Opens Environment, the given lighting scene (made active) and Core.</summary>
    static bool Open(string lightingScene)
    {
        if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return false;
        var c = Content;
        EditorSceneManager.OpenScene(PathOf(c.environmentScene), OpenSceneMode.Single);
        var lighting = EditorSceneManager.OpenScene(PathOf(lightingScene), OpenSceneMode.Additive);
        EditorSceneManager.OpenScene(PathOf(c.coreScene), OpenSceneMode.Additive);
        SceneManager.SetActiveScene(lighting);
        BakedLightingSet.ApplyActive();
        return true;
    }

    [MenuItem("Tools/Reading World/Bake Day Lighting", priority = 120)]
    static void BakeDay() => Bake(Content.dayLightingScene);

    [MenuItem("Tools/Reading World/Bake Night Lighting", priority = 121)]
    static void BakeNight() => Bake(Content.nightLightingScene);

    static string baking;

    static void Bake(string lightingScene)
    {
        if (Lightmapping.isRunning) { Debug.LogWarning("A bake is already running."); return; }
        if (!Open(lightingScene)) return;
        ClearBatchingStatic();

        baking = lightingScene;
        Lightmapping.bakeCompleted -= OnBakeCompleted;
        Lightmapping.bakeCompleted += OnBakeCompleted;
        if (!Lightmapping.BakeAsync())
        {
            Lightmapping.bakeCompleted -= OnBakeCompleted;
            baking = null;
            Debug.LogError("The bake could not start.");
            return;
        }
        Debug.Log($"Baking {lightingScene}... (progress in the bottom-right of the editor)");
    }

    static void OnBakeCompleted()
    {
        Lightmapping.bakeCompleted -= OnBakeCompleted;
        if (baking == null) return;
        var lightingName = baking;
        baking = null;

        var c = Content;
        var lighting = SceneManager.GetSceneByName(lightingName);
        if (!lighting.isLoaded) { Debug.LogError($"{lightingName} was closed during the bake; nothing captured."); return; }

        // 1. Capture the bake into the lighting scene.
        var set = FindSet(lighting);
        Undo.RecordObject(set, "Capture bake");
        var maps = LightmapSettings.lightmaps;
        set.mode = LightmapSettings.lightmapsMode;
        set.lightmapColor = Array.ConvertAll(maps, m => m.lightmapColor);
        set.lightmapDir = Array.ConvertAll(maps, m => m.lightmapDir);
        set.shadowMask = Array.ConvertAll(maps, m => m.shadowMask);
        var probes = LightmapSettings.lightProbes;
        set.lightProbes = probes != null && EditorUtility.IsPersistent(probes) ? probes : null;
        if (probes != null && set.lightProbes == null)
            Debug.LogWarning("Baked light probes aren't saved as an asset, so they won't switch between day and night.");

        // Each baked object keeps its own place in this bake's lightmaps.
        int count = 0;
        foreach (var name in new[] { c.environmentScene, c.coreScene, lightingName })
        {
            var scene = SceneManager.GetSceneByName(name);
            foreach (var root in scene.GetRootGameObjects())
            foreach (var r in root.GetComponentsInChildren<Renderer>(true))
            {
                bool baked = r.lightmapIndex >= 0 && r.lightmapIndex < 0xFFFE;
                var slots = r.GetComponent<BakedLightmapSlots>();
                if (!baked)
                {
                    if (slots == null) continue;
                    Undo.RecordObject(slots, "Capture bake");
                    slots.Remove(lightingName);
                    if (slots.slots.Count == 0) Undo.DestroyObjectImmediate(slots);
                    else EditorUtility.SetDirty(slots);
                    continue;
                }
                if (slots == null) slots = Undo.AddComponent<BakedLightmapSlots>(r.gameObject);
                else Undo.RecordObject(slots, "Capture bake");
                slots.Set(lightingName, r.lightmapIndex, r.lightmapScaleOffset);
                EditorUtility.SetDirty(slots);
                count++;
            }
        }
        set.objectCount = count;
        set.bakedAt = DateTime.Now.ToString("yyyy-MM-dd HH:mm");
        EditorUtility.SetDirty(set);

        // 2. The shared scenes keep no bake of their own (it would belong to whichever was baked last).
        foreach (var name in new[] { c.environmentScene, c.coreScene })
        {
            var scene = SceneManager.GetSceneByName(name);
            SceneManager.SetActiveScene(scene);
            Lightmapping.lightingDataAsset = null;
            EditorSceneManager.MarkSceneDirty(scene);
        }
        SceneManager.SetActiveScene(lighting);
        EditorSceneManager.MarkSceneDirty(lighting);
        EditorSceneManager.SaveOpenScenes();
        set.Apply();

        Debug.Log($"{lightingName}: captured {set.lightmapColor.Length} lightmaps and {count} lightmapped objects.", set);
    }

    /// <summary>
    /// Static batching merges meshes at build time with their lightmap position fixed, so the day/night swap
    /// can't reach them (no baked shadows in builds). Keep it off on everything in the shared scenes.
    /// </summary>
    static void ClearBatchingStatic()
    {
        var c = Content;
        foreach (var name in new[] { c.environmentScene, c.coreScene })
        {
            var scene = SceneManager.GetSceneByName(name);
            int n = 0;
            foreach (var root in scene.GetRootGameObjects())
            foreach (var t in root.GetComponentsInChildren<Transform>(true))
            {
                var flags = GameObjectUtility.GetStaticEditorFlags(t.gameObject);
                if ((flags & StaticEditorFlags.BatchingStatic) == 0) continue;
                GameObjectUtility.SetStaticEditorFlags(t.gameObject, flags & ~StaticEditorFlags.BatchingStatic);
                n++;
            }
            if (n == 0) continue;
            EditorSceneManager.MarkSceneDirty(scene);
            Debug.Log($"{name}: turned off Batching Static on {n} objects (it stops day/night lightmaps working in builds).");
        }
    }

    static BakedLightingSet FindSet(Scene lighting)
    {
        foreach (var root in lighting.GetRootGameObjects())
        {
            var s = root.GetComponentInChildren<BakedLightingSet>(true);
            if (s != null) return s;
        }
        var go = new GameObject("Baked Lighting");
        SceneManager.MoveGameObjectToScene(go, lighting);
        Undo.RegisterCreatedObjectUndo(go, "Baked Lighting");
        return go.AddComponent<BakedLightingSet>();
    }
}
