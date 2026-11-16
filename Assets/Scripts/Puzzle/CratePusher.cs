using UnityEngine;

/// <summary>
/// Lives on the player (added automatically by <see cref="PushCrate"/>). Unity only tells the player's own
/// GameObject when its CharacterController walks into something, so this passes that on to the crate.
/// </summary>
public class CratePusher : MonoBehaviour
{
    void OnControllerColliderHit(ControllerColliderHit hit)
    {
        var crate = hit.collider.GetComponent<PushCrate>();
        if (crate != null) crate.Push(hit.normal, hit.moveDirection);
    }
}
