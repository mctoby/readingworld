using StarterAssets;
using UnityEngine;
using UnityEngine.UIElements;

/// <summary>
/// Freezes the player and hides the touchscreen controls during cutscene-like moments (conversations,
/// the library books arriving...). Calls are counted, so overlapping sequences are safe:
/// the player is only released when every <see cref="Lock"/> has a matching <see cref="Unlock"/>.
/// </summary>
public static class PlayerControlLock
{
    static int count;
    static ThirdPersonController controller;
    static UIDocument touchDoc;

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
    static void ResetState()
    {
        count = 0;
        controller = null;
        touchDoc = null;
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
            var inputs = player.GetComponent<StarterAssetsInputs>();
            if (inputs != null)
            {
                inputs.MoveInput(Vector2.zero);
                inputs.LookInput(Vector2.zero);
                inputs.JumpInput(false);
                inputs.SprintInput(false);
            }
        }

        var touch = Object.FindAnyObjectByType<TouchscreenInput>(FindObjectsInactive.Include);
        touchDoc = touch != null ? touch.GetComponent<UIDocument>() : null;
        SetTouchUIVisible(false);
    }

    public static void Unlock()
    {
        if (count == 0) return;
        if (--count > 0) return;

        if (controller != null) controller.enabled = true;
        SetTouchUIVisible(true);
    }

    // Hide via the UI Toolkit root instead of deactivating the GameObject: deactivating rebuilds the
    // UIDocument's visual tree on re-enable, which loses the joystick/button callbacks.
    static void SetTouchUIVisible(bool visible)
    {
        if (touchDoc == null || touchDoc.rootVisualElement == null) return;
        touchDoc.rootVisualElement.style.display = visible ? DisplayStyle.Flex : DisplayStyle.None;
    }
}
