using StarterAssets;
using UnityEngine;

/// <summary>
/// Freezes the player, hides the touchscreen controls and frees the mouse cursor during cutscene-like moments
/// (conversations, the library books arriving...). Calls are counted, so overlapping sequences are safe:
/// the player is only released when every <see cref="Lock"/> has a matching <see cref="Unlock"/>.
/// </summary>
public static class PlayerControlLock
{
    static int count;
    static ThirdPersonController controller;
    static StarterAssetsInputs inputs;
    static GameObject touchControls;
    static bool wasCursorLocked;

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
    static void ResetState()
    {
        count = 0;
        controller = null;
        inputs = null;
        touchControls = null;
    }

    public static void Lock()
    {
        if (count++ > 0) return;

        var player = GameObject.FindGameObjectWithTag("Player");
        if (player != null)
        {
            controller = player.GetComponent<ThirdPersonController>();
            if (controller != null) controller.enabled = false;

            // Clear any held keys / touch-stick input so the player doesn't drift afterwards.
            inputs = player.GetComponent<StarterAssetsInputs>();
            if (inputs != null)
            {
                inputs.MoveInput(Vector2.zero);
                inputs.LookInput(Vector2.zero);
                inputs.JumpInput(false);
                inputs.SprintInput(false);

                // Free the mouse so dialogue buttons can be clicked.
                wasCursorLocked = inputs.cursorLocked;
                inputs.cursorLocked = false;
            }
        }
        Cursor.lockState = CursorLockMode.None;
        Cursor.visible = true;

        var touch = Object.FindAnyObjectByType<TouchControlsCanvas>(FindObjectsInactive.Include);
        touchControls = touch != null ? touch.gameObject : null;
        if (touchControls != null) touchControls.SetActive(false);
    }

    /// <summary>Shows or hides the player's model (all renderers under the Player object).</summary>
    public static void SetPlayerVisible(bool visible)
    {
        var player = GameObject.FindGameObjectWithTag("Player");
        if (player == null) return;
        foreach (var r in player.GetComponentsInChildren<Renderer>(true))
            r.enabled = visible;
    }

    public static void Unlock()
    {
        if (count == 0) return;
        if (--count > 0) return;

        if (controller != null) controller.enabled = true;
        if (inputs != null) inputs.cursorLocked = wasCursorLocked;
        if (wasCursorLocked)
        {
            Cursor.lockState = CursorLockMode.Locked;
            Cursor.visible = false;
        }
        if (touchControls != null) touchControls.SetActive(true);
    }
}
