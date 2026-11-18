using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.SceneManagement;

/// <summary>
/// Where this object sits in each lighting scene's lightmaps (day and night). Added and filled in by
/// Tools > Reading World > Bake Day/Night Lighting; don't edit by hand. Kept on the object itself so it is found
/// the same way in the editor and in builds (scene root order isn't the same in a build).
/// </summary>
[ExecuteAlways, DisallowMultipleComponent, AddComponentMenu("")]
public class BakedLightmapSlots : MonoBehaviour
{
    [Serializable]
    public class Slot
    {
        public string lighting;      // lighting scene name, e.g. "Lighting_Day"
        public int index;
        public Vector4 scaleOffset;
    }

    public List<Slot> slots = new();

    static readonly List<BakedLightmapSlots> all = new();
    public static IReadOnlyList<BakedLightmapSlots> All => all;

    void OnEnable()
    {
        all.Add(this);
        // Loaded after the lighting (e.g. Core): take the active lighting's slot straight away.
        Apply(SceneManager.GetActiveScene().name);
    }

    void OnDisable() => all.Remove(this);

    public Slot Find(string lighting)
    {
        foreach (var s in slots)
            if (s.lighting == lighting) return s;
        return null;
    }

    /// <summary>Uses this lighting's slot. False if the object has none for it.</summary>
    public bool Apply(string lighting)
    {
        var s = Find(lighting);
        if (s == null) return false;
        var r = GetComponent<Renderer>();
        if (r == null) return false;
        r.lightmapIndex = s.index;
        r.lightmapScaleOffset = s.scaleOffset;
        return true;
    }

#if UNITY_EDITOR
    public void Set(string lighting, int index, Vector4 scaleOffset)
    {
        var s = Find(lighting);
        if (s == null) slots.Add(s = new Slot { lighting = lighting });
        s.index = index;
        s.scaleOffset = scaleOffset;
    }

    public void Remove(string lighting) => slots.RemoveAll(s => s.lighting == lighting);
#endif
}
