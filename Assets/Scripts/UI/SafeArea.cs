using UnityEngine;

/// <summary>Keeps this RectTransform inside the screen's safe area (phone notches, rounded corners).</summary>
[RequireComponent(typeof(RectTransform))]
public class SafeArea : MonoBehaviour
{
    Rect applied;
    Vector2Int screenSize;

    void OnEnable() => Apply();

    void Update()
    {
        if (Screen.safeArea != applied || screenSize.x != Screen.width || screenSize.y != Screen.height)
            Apply();
    }

    void Apply()
    {
        applied = Screen.safeArea;
        screenSize = new Vector2Int(Screen.width, Screen.height);
        if (screenSize.x == 0 || screenSize.y == 0) return;

        var rt = (RectTransform)transform;
        rt.anchorMin = new Vector2(applied.xMin / screenSize.x, applied.yMin / screenSize.y);
        rt.anchorMax = new Vector2(applied.xMax / screenSize.x, applied.yMax / screenSize.y);
        rt.offsetMin = rt.offsetMax = Vector2.zero;
    }
}
