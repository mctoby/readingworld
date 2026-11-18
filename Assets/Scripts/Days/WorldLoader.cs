using UnityEngine;
using UnityEngine.SceneManagement;

/// <summary>
/// The world is three scenes loaded together:
///   Environment     the scenery, shared by day and night;
///   Lighting_Day / Lighting_Night   sun, sky, volume, probes, music and baked lightmaps;
///   Core            NPCs, player, cameras and UI.
/// The lighting scene is made the active scene, because Unity takes the sky, ambient light and fog from it.
/// Scene names live in Resources/DailyContent.
/// </summary>
public static class WorldLoader
{
    static string pendingLighting;

    /// <summary>Loads the world for 'day' (replacing whatever is open, e.g. the main menu).</summary>
    public static void Load(int day)
    {
        var c = DailyContent.Instance;
        if (c == null) { Debug.LogError("WorldLoader: Resources/DailyContent is missing."); return; }

        pendingLighting = c.LightingSceneFor(day);
        SceneManager.sceneLoaded -= OnSceneLoaded;
        SceneManager.sceneLoaded += OnSceneLoaded;

        // Scenery first so the ground exists before the player's scene wakes up.
        SceneManager.LoadScene(c.environmentScene, LoadSceneMode.Single);
        SceneManager.LoadScene(pendingLighting, LoadSceneMode.Additive);
        SceneManager.LoadScene(c.coreScene, LoadSceneMode.Additive);
    }

    static void OnSceneLoaded(Scene scene, LoadSceneMode mode)
    {
        if (scene.name == pendingLighting) SceneManager.SetActiveScene(scene);

        var c = DailyContent.Instance;
        if (!IsLoaded(c.environmentScene) || !IsLoaded(pendingLighting) || !IsLoaded(c.coreScene)) return;

        SceneManager.sceneLoaded -= OnSceneLoaded;
        pendingLighting = null;
        BakedLightingSet.ApplyActive();
    }

    static bool IsLoaded(string name) => SceneManager.GetSceneByName(name).isLoaded;

    /// <summary>
    /// Editor convenience: pressing Play with only some of the world scenes open (say, just Core) loads the rest,
    /// using the lighting scene that's open, or else today's.
    /// </summary>
    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
    static void CompleteWorld()
    {
        var c = DailyContent.Instance;
        if (c == null) return;

        bool coreOpen = IsLoaded(c.coreScene), envOpen = IsLoaded(c.environmentScene);
        string lighting = IsLoaded(c.dayLightingScene) ? c.dayLightingScene
                        : IsLoaded(c.nightLightingScene) ? c.nightLightingScene : null;
        if (!coreOpen && !envOpen && lighting == null) return;   // e.g. the main menu

        lighting ??= c.LightingSceneFor(GameDay.Current);
        pendingLighting = lighting;
        SceneManager.sceneLoaded -= OnSceneLoaded;
        SceneManager.sceneLoaded += OnSceneLoaded;

        if (!envOpen) SceneManager.LoadScene(c.environmentScene, LoadSceneMode.Additive);
        if (!IsLoaded(lighting)) SceneManager.LoadScene(lighting, LoadSceneMode.Additive);
        if (!coreOpen) SceneManager.LoadScene(c.coreScene, LoadSceneMode.Additive);

        // Everything was already open: just make sure lighting is in charge.
        if (envOpen && coreOpen && IsLoaded(lighting))
        {
            SceneManager.SetActiveScene(SceneManager.GetSceneByName(lighting));
            SceneManager.sceneLoaded -= OnSceneLoaded;
            pendingLighting = null;
            BakedLightingSet.ApplyActive();
        }
    }
}
