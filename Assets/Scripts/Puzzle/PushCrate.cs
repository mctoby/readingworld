using System.Collections;
using UnityEngine;

/// <summary>
/// A crate that behaves like the boxes in an old-school 2D box puzzle. It never tips, lifts or spins:
/// lean on one of its sides for a moment and it slides exactly one step along X or Z, then stops.
/// It will not move if a hedge, another crate or anything else solid is in the way.
/// Needs a Collider and a Rigidbody (which this script makes kinematic). The player is given a
/// <see cref="CratePusher"/> automatically.
/// </summary>
[RequireComponent(typeof(Rigidbody))]
public class PushCrate : MonoBehaviour
{
    [Tooltip("How far the crate slides per push. Use the crate's own width for a classic one-square step.")]
    [SerializeField] float stepSize = 0.5f;

    [Tooltip("Resistance: how long the player must keep pushing before the crate gives way, in seconds.")]
    [SerializeField] float pushDelay = 0.25f;

    [Tooltip("How long the slide into place takes, in seconds.")]
    [SerializeField] float slideTime = 0.3f;

    [Tooltip("What can block the crate. The player is always ignored.")]
    [SerializeField] LayerMask blockedBy = ~0;

    [SerializeField] string playerTag = "Player";

    Rigidbody body;
    Collider box;
    Transform player;

    Vector3 pushDir;          // direction being leaned on (one of the four axis directions)
    float pushTimer;          // how long it has been leaned on
    bool pushedThisFrame;
    bool busy;                // sliding, or bumping against something
    readonly RaycastHit[] hits = new RaycastHit[8];

    void Awake()
    {
        body = GetComponent<Rigidbody>();
        box = GetComponent<Collider>();

        // Kinematic: physics can no longer shove, tip or drop the crate. Only this script moves it.
        body.isKinematic = true;
        body.useGravity = false;
    }

    void Start()
    {
        var p = GameObject.FindGameObjectWithTag(playerTag);
        if (p == null) return;
        player = p.transform;
        if (p.GetComponent<CratePusher>() == null) p.AddComponent<CratePusher>();
    }

    /// <summary>
    /// Called by <see cref="CratePusher"/> every frame the player walks into this crate.
    /// 'normal' is the surface normal at the contact, 'moveDirection' is the way the player is trying to go.
    /// </summary>
    public void Push(Vector3 normal, Vector3 moveDirection)
    {
        if (busy) return;

        // Which side is being pushed? Ignore the top and any corner-on contact.
        Vector3 dir;
        if (Mathf.Abs(normal.x) > 0.8f) dir = new Vector3(-Mathf.Sign(normal.x), 0f, 0f);
        else if (Mathf.Abs(normal.z) > 0.8f) dir = new Vector3(0f, 0f, -Mathf.Sign(normal.z));
        else return;

        // The player has to be walking into that side, not just brushing along it.
        moveDirection.y = 0f;
        if (Vector3.Dot(moveDirection.normalized, dir) < 0.6f) return;

        if (dir != pushDir)
        {
            pushDir = dir;
            pushTimer = 0f;
        }
        pushedThisFrame = true;
    }

    void LateUpdate()
    {
        if (busy) return;

        if (!pushedThisFrame)
        {
            pushTimer = 0f;   // let go: the resistance starts again
            return;
        }
        pushedThisFrame = false;

        pushTimer += Time.deltaTime;
        if (pushTimer < pushDelay) return;
        pushTimer = 0f;

        StartCoroutine(IsBlocked(pushDir) ? Bump(pushDir) : Slide(pushDir));
    }

    // Would the crate hit something solid if it moved one step in 'dir'?
    bool IsBlocked(Vector3 dir)
    {
        // Slightly smaller than the crate, so the ground and anything it is merely resting against don't count.
        Vector3 half = box.bounds.extents - Vector3.one * 0.02f;
        int n = Physics.BoxCastNonAlloc(box.bounds.center, half, dir, hits, Quaternion.identity,
            stepSize, blockedBy, QueryTriggerInteraction.Ignore);

        for (int i = 0; i < n; i++)
        {
            var other = hits[i].collider;
            if (other == box) continue;
            if (player != null && other.transform.IsChildOf(player)) continue;
            return true;
        }
        return false;
    }

    // Glide one step and settle into place.
    IEnumerator Slide(Vector3 dir)
    {
        busy = true;
        Vector3 from = transform.position;
        Vector3 to = from + dir * stepSize;

        for (float t = 0f; t < slideTime; t += Time.deltaTime)
        {
            transform.position = Vector3.Lerp(from, to, Juice.OutCubic(t / slideTime));
            yield return null;
        }
        transform.position = to;
        busy = false;
    }

    // Blocked: a tiny nudge forward and back, so it is clear the crate tried and can't go that way.
    IEnumerator Bump(Vector3 dir)
    {
        busy = true;
        Vector3 from = transform.position;
        const float time = 0.18f, distance = 0.03f;

        for (float t = 0f; t < time; t += Time.deltaTime)
        {
            transform.position = from + dir * (Mathf.Sin(t / time * Mathf.PI) * distance);
            yield return null;
        }
        transform.position = from;
        busy = false;
    }
}
