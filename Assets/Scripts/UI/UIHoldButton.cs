using UnityEngine;
using UnityEngine.EventSystems;

/// <summary>An on-screen button that reports true while it is held down (e.g. Sprint) and false when let go.</summary>
public class UIHoldButton : MonoBehaviour, IPointerDownHandler, IPointerUpHandler
{
    public event System.Action<bool> Changed;

    bool held;

    void OnDisable() => Set(false);

    public void OnPointerDown(PointerEventData e) => Set(true);
    public void OnPointerUp(PointerEventData e) => Set(false);

    void Set(bool value)
    {
        if (held == value) return;
        held = value;
        Changed?.Invoke(value);
    }
}
