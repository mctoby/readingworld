using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// Puts each NPC on a different locator, chosen at random using the in-game day as the seed. Everyone playing
/// the same day sees the NPCs in the same places; the next day they move. Put this on the parent of the locators;
/// every child is a locator. The Librarian is left out by not listing him.
/// </summary>
public class NPCPlacer : MonoBehaviour
{
    [Tooltip("The NPCs to move. Keep this order fixed: changing it changes everyone's layout.")]
    [SerializeField] Transform[] npcs;

    [Tooltip("Height of each NPC above its locator (the NPCs' pivots sit 0.25 above the ground).")]
    [SerializeField] float heightOffset = 0.25f;

    [Tooltip("Turn each NPC to match its locator's rotation. Off: they keep the rotation they have in the scene.")]
    [SerializeField] bool useLocatorRotation = false;

    [Tooltip("Mixed into the seed. Change it to get a whole new set of layouts for every day.")]
    [SerializeField] int seedSalt = 0;

    void Awake() => Place(GameDay.Current);

    void OnEnable() => GameDay.Changed += OnDayChanged;
    void OnDisable() => GameDay.Changed -= OnDayChanged;
    void OnDayChanged() => Place(GameDay.Current);

    void Place(int day)
    {
        var spots = new List<Transform>();
        foreach (Transform child in transform) spots.Add(child);
        if (npcs == null || npcs.Length == 0) return;
        if (spots.Count < npcs.Length)
        {
            Debug.LogWarning($"{name}: {npcs.Length} NPCs but only {spots.Count} locators; some NPCs stay where they are.", this);
        }

        // Same seed -> same shuffle on every device. Fisher-Yates over the locators.
        var rng = new System.Random(day * 7919 + seedSalt);
        for (int i = spots.Count - 1; i > 0; i--)
        {
            int j = rng.Next(i + 1);
            (spots[i], spots[j]) = (spots[j], spots[i]);
        }

        for (int i = 0; i < npcs.Length && i < spots.Count; i++)
        {
            var npc = npcs[i];
            if (npc == null) continue;
            npc.position = spots[i].position + Vector3.up * heightOffset;
            if (useLocatorRotation) npc.rotation = Quaternion.Euler(0f, spots[i].eulerAngles.y, 0f);
            Physics.SyncTransforms();
        }
    }

    void OnDrawGizmos()
    {
        Gizmos.color = new Color(0.2f, 0.8f, 1f, 0.8f);
        foreach (Transform child in transform)
        {
            Gizmos.DrawWireSphere(child.position + Vector3.up * 0.5f, 0.4f);
            Gizmos.DrawLine(child.position, child.position + child.forward * 0.7f);
        }
    }
}
