using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.SceneManagement;

/// <summary>
/// One bake of the world's lighting, kept in a lighting scene (Lighting_Day or Lighting_Night). Unity can only
/// store one bake per scene, so the shared Environment scene keeps none: each lighting scene keeps its lightmaps
/// here, each baked object keeps its place in them (BakedLightmapSlots), and this puts them together when its
/// lighting scene is the active one.
/// Filled in by Tools > Reading World > Bake Day Lighting / Bake Night Lighting. Don't edit by hand.
/// </summary>
[ExecuteAlways]
public class BakedLightingSet : MonoBehaviour
{
    public LightmapsMode mode = LightmapsMode.CombinedDirectional;
    public Texture2D[] lightmapColor = Array.Empty<Texture2D>();
    public Texture2D[] lightmapDir = Array.Empty<Texture2D>();
    public Texture2D[] shadowMask = Array.Empty<Texture2D>();
    public LightProbes lightProbes;
    [Tooltip("How many objects were lightmapped in the bake, for reference.")]
    public int objectCount;
    [Tooltip("When this was baked, for reference.")]
    public string bakedAt;

    static readonly List<BakedLightingSet> all = new();

    void OnEnable()
    {
        all.Add(this);
        Apply();
    }

    void OnDisable() => all.Remove(this);

    void Start() => Apply();

    /// <summary>Applies the set in the active scene (called once the whole world has loaded).</summary>
    public static void ApplyActive()
    {
        foreach (var s in all) s.Apply();
    }

    /// <summary>Puts this bake onto the world, if this lighting scene is the active one.</summary>
    public void Apply()
    {
        if (gameObject.scene != SceneManager.GetActiveScene() || lightmapColor.Length == 0) return;

        var maps = new LightmapData[lightmapColor.Length];
        for (int i = 0; i < maps.Length; i++)
        {
            maps[i] = new LightmapData
            {
                lightmapColor = lightmapColor[i],
                lightmapDir = i < lightmapDir.Length ? lightmapDir[i] : null,
                shadowMask = i < shadowMask.Length ? shadowMask[i] : null,
            };
        }
        LightmapSettings.lightmapsMode = mode;
        LightmapSettings.lightmaps = maps;
        if (lightProbes != null) LightmapSettings.lightProbes = lightProbes;

        string lighting = gameObject.scene.name;
        int applied = 0, batched = 0;
        foreach (var o in BakedLightmapSlots.All)
        {
            if (!o.Apply(lighting)) continue;
            applied++;
            var r = o.GetComponent<Renderer>();
            if (r != null && r.isPartOfStaticBatch) batched++;
        }

        if (Application.isPlaying && Debug.isDebugBuild)
            Debug.Log($"{lighting}: {maps.Length} lightmaps on {applied} objects (baked {bakedAt}).", this);
        if (batched > 0)
            Debug.LogWarning($"{lighting}: {batched} baked objects are static-batched, so they won't show this " +
                             "lighting. Turn off Batching Static on them, or Static Batching in Player Settings.", this);
    }
}
