using UnityEngine;

/// <summary>Shared easing curves and effect helpers for the game's "juice" (small bits of motion and feedback).</summary>
public static class Juice
{
    /// <summary>Overshoots past 1 then settles - the classic "pop". k is 0..1.</summary>
    public static float OutBack(float k)
    {
        k = Mathf.Clamp01(k);
        const float c1 = 1.70158f, c3 = c1 + 1f;
        float x = k - 1f;
        return 1f + c3 * x * x * x + c1 * x * x;
    }

    public static float OutCubic(float k)
    {
        k = 1f - Mathf.Clamp01(k);
        return 1f - k * k * k;
    }

    public static float InCubic(float k)
    {
        k = Mathf.Clamp01(k);
        return k * k * k;
    }

    /// <summary>Spawns a one-shot particle effect (it destroys itself when finished). Safe to call with null.</summary>
    public static void Burst(GameObject effect, Vector3 position)
    {
        if (effect != null) Object.Instantiate(effect, position, Quaternion.identity);
    }
}
