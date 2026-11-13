using StarterAssets;
using UnityEngine;

/// <summary>
/// Connects the on-screen sticks and buttons (uGUI) to the player's StarterAssetsInputs.
/// Replaces the Starter Assets UI Toolkit touch controls.
/// </summary>
public class TouchControlsCanvas : MonoBehaviour
{
    [SerializeField] UIStick moveStick;
    [SerializeField] UIStick lookStick;
    [SerializeField] UIHoldButton jumpButton;
    [SerializeField] UIHoldButton sprintButton;

    [Tooltip("The look stick gives -1..1; this scales it to the same range the mouse delta uses.")]
    [SerializeField] float lookMultiplier = 80f;
    [SerializeField] bool invertLookY = true;

    StarterAssetsInputs inputs;

    void Start()
    {
        var player = GameObject.FindGameObjectWithTag("Player");
        if (player != null) inputs = player.GetComponent<StarterAssetsInputs>();
    }

    void OnEnable()
    {
        moveStick.Changed += OnMove;
        lookStick.Changed += OnLook;
        jumpButton.Changed += OnJump;
        sprintButton.Changed += OnSprint;
    }

    void OnDisable()
    {
        moveStick.Changed -= OnMove;
        lookStick.Changed -= OnLook;
        jumpButton.Changed -= OnJump;
        sprintButton.Changed -= OnSprint;

        // Don't leave the player drifting if the controls are hidden mid-drag.
        if (inputs != null)
        {
            inputs.MoveInput(Vector2.zero);
            inputs.LookInput(Vector2.zero);
            inputs.lookFromTouch = false;
            inputs.JumpInput(false);
            inputs.SprintInput(false);
        }
    }

    void OnMove(Vector2 v)
    {
        if (inputs != null) inputs.MoveInput(v);
    }

    void OnLook(Vector2 v)
    {
        if (inputs == null) return;
        if (invertLookY) v.y = -v.y;
        inputs.lookFromTouch = v != Vector2.zero;   // touch look is per-frame, mouse look is per-event
        inputs.LookInput(v * lookMultiplier);
    }

    void OnJump(bool pressed)
    {
        if (inputs != null) inputs.JumpInput(pressed);
    }

    void OnSprint(bool pressed)
    {
        if (inputs != null) inputs.SprintInput(pressed);
    }
}
