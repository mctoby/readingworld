using UnityEngine;

/// <summary>
/// Put on the player. Tells the "Reading World/Soft Bend Lit" shader where the player is, so plants and
/// mushrooms using it lean away as the player walks through them. The settings apply to every bending object.
/// Runs in the editor too, so the idle sway can be previewed without pressing Play.
/// </summary>
[ExecuteAlways]
public class SoftBendPlayer : MonoBehaviour
{
    [Tooltip("How close (metres) the player must be to push a plant.")]
    [SerializeField] float radius = 0.8f;
    [Tooltip("How far plants lean away. 1 = the tip moves its own height.")]
    [Range(0f, 2f)] [SerializeField] float strength = 0.9f;
    [Tooltip("Height (metres) at which a plant bends fully. Shorter parts bend less, so the base stays put.")]
    [SerializeField] float bendHeight = 0.2f;
    [Tooltip("Gentle idle sway in the breeze. 0 = still.")]
    [Range(0f, 0.3f)] [SerializeField] float sway = 0.06f;
    [SerializeField] float swaySpeed = 1.6f;
    [Tooltip("Seconds for plants to follow the player. Higher = slower, softer movement.")]
    [Range(0f, 0.5f)] [SerializeField] float smoothing = 0.12f;

    static readonly int PlayerId = Shader.PropertyToID("_SoftBendPlayer");
    static readonly int ParamsId = Shader.PropertyToID("_SoftBendParams");

    Vector3 smoothed;
    Vector3 velocity;
    bool started;

    void OnEnable() => started = false;

    void LateUpdate()
    {
        Vector3 target = transform.position;
        if (!started || !Application.isPlaying || smoothing <= 0f)
        {
            smoothed = target;
            velocity = Vector3.zero;
            started = true;
        }
        else
        {
            // Plants lag slightly behind the player, so they ease over and spring back instead of snapping.
            smoothed = Vector3.SmoothDamp(smoothed, target, ref velocity, smoothing);
        }

        Shader.SetGlobalVector(PlayerId, new Vector4(smoothed.x, smoothed.y, smoothed.z, radius));
        Shader.SetGlobalVector(ParamsId, new Vector4(strength, bendHeight, sway, swaySpeed));
    }

    void OnDisable()
    {
        // Leave plants upright and still when there's no player.
        Shader.SetGlobalVector(ParamsId, Vector4.zero);
    }
}
