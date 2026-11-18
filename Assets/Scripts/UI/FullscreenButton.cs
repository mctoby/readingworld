using System.Runtime.InteropServices;
using UnityEngine;
using UnityEngine.EventSystems;

/// <summary>
/// A "Full screen" button for the web build on phones and tablets. Hidden on desktop and once the game is fullscreen.
/// Android Chrome and iPad Safari go fullscreen. iPhone Safari doesn't allow web pages to go fullscreen, so there
/// the button shows a tip instead: add the game to the Home Screen, which opens it without the browser bars.
/// Put this on the button itself (it reacts to the press, not to onClick, because browsers only allow
/// fullscreen during a tap).
/// </summary>
public class FullscreenButton : MonoBehaviour, IPointerDownHandler
{
    [Tooltip("Shown on iPhone instead of going fullscreen, e.g. \"Tap Share, then Add to Home Screen\". Starts hidden.")]
    [SerializeField] GameObject iPhoneTip;
    [Tooltip("How long the iPhone tip stays up, in seconds.")]
    [SerializeField] float tipTime = 5f;
    [Tooltip("Also turn Android phones sideways (landscape) when going fullscreen.")]
    [SerializeField] bool lockLandscape = true;
    [Tooltip("Editor only: show the button so it can be positioned and styled.")]
    [SerializeField] bool showInEditor = true;

#if UNITY_WEBGL && !UNITY_EDITOR
    [DllImport("__Internal")] static extern int Fullscreen_IsMobile();
    [DllImport("__Internal")] static extern int Fullscreen_IsSupported();
    [DllImport("__Internal")] static extern int Fullscreen_IsActive();
    [DllImport("__Internal")] static extern void Fullscreen_RequestOnRelease(int lockLandscape);
#else
    static int Fullscreen_IsMobile() => 0;
    static int Fullscreen_IsSupported() => 1;
    static int Fullscreen_IsActive() => 0;
    static void Fullscreen_RequestOnRelease(int lockLandscape) => Debug.Log("Fullscreen requested (only works in a web build).");
#endif

    float tipUntil;

    void Start()
    {
        if (iPhoneTip != null) iPhoneTip.SetActive(false);
#if UNITY_EDITOR
        if (!showInEditor) gameObject.SetActive(false);
#else
        if (Fullscreen_IsMobile() == 0) gameObject.SetActive(false);
#endif
        InvokeRepeating(nameof(Check), 0.5f, 0.5f);
    }

    // Hide once fullscreen; bring the button back if the player leaves fullscreen.
    void Check()
    {
        bool active = Fullscreen_IsActive() == 1;
        foreach (Transform child in transform) child.gameObject.SetActive(!active);
        var graphic = GetComponent<UnityEngine.UI.Graphic>();
        if (graphic != null) graphic.enabled = !active;

        if (iPhoneTip != null && iPhoneTip.activeSelf && Time.unscaledTime > tipUntil) iPhoneTip.SetActive(false);
    }

    public void OnPointerDown(PointerEventData eventData)
    {
        if (Fullscreen_IsActive() == 1) return;

        if (Fullscreen_IsSupported() == 1)
        {
            Fullscreen_RequestOnRelease(lockLandscape ? 1 : 0);
        }
        else if (iPhoneTip != null)
        {
            iPhoneTip.SetActive(true);
            tipUntil = Time.unscaledTime + tipTime;
        }
    }
}
