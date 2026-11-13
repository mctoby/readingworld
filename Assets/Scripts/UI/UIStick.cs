using UnityEngine;
using UnityEngine.EventSystems;

/// <summary>
/// An on-screen joystick for a Canvas. Put it on the stick's background image (pivot in the centre) and
/// assign the child "handle". Reports a value in the range -1..1 on both axes (y up).
/// </summary>
public class UIStick : MonoBehaviour, IPointerDownHandler, IDragHandler, IPointerUpHandler
{
    [SerializeField] RectTransform handle;

    public event System.Action<Vector2> Changed;

    RectTransform rect;

    void Awake() => rect = (RectTransform)transform;

    void OnDisable() => Release();

    public void OnPointerDown(PointerEventData e) => Move(e);
    public void OnDrag(PointerEventData e) => Move(e);
    public void OnPointerUp(PointerEventData e) => Release();

    void Move(PointerEventData e)
    {
        RectTransformUtility.ScreenPointToLocalPointInRectangle(rect, e.position, e.pressEventCamera, out var local);
        float radius = rect.rect.width * 0.5f;
        Vector2 clamped = Vector2.ClampMagnitude(local, radius);
        handle.anchoredPosition = clamped;
        Changed?.Invoke(clamped / radius);
    }

    void Release()
    {
        if (handle != null) handle.anchoredPosition = Vector2.zero;
        Changed?.Invoke(Vector2.zero);
    }
}
