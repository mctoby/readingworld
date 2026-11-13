using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

/// <summary>
/// Makes a Button feel alive: it pops in when shown, grows on hover, squashes when pressed and bumps when
/// clicked. Other scripts can call <see cref="Punch"/>, <see cref="Shake"/> and <see cref="Flash"/> for
/// right / wrong answer feedback. Uses unscaled time.
/// </summary>
[RequireComponent(typeof(Button))]
public class JuiceButton : MonoBehaviour, IPointerEnterHandler, IPointerExitHandler, IPointerDownHandler, IPointerUpHandler
{
    [SerializeField] float hoverScale = 1.08f;
    [SerializeField] float pressScale = 0.92f;
    [SerializeField] float introDuration = 0.4f;
    [SerializeField] bool introOnEnable = true;

    Button button;
    Graphic graphic;
    RectTransform rt;
    Vector3 baseScale = Vector3.one;
    Color baseColor = Color.white;
    bool init;

    bool hovered, pressed;
    float hover = 1f;
    float punchP, punchV;
    float introTime = -1f, introDelay;
    float shakeTime = -1f, shakeAmp, shakeApplied;
    float flashTime = -1f;
    Color flashColor;

    const float ShakeDuration = 0.4f, FlashDuration = 0.5f;

    void Init()
    {
        if (init) return;
        init = true;
        button = GetComponent<Button>();
        graphic = button.targetGraphic;
        rt = (RectTransform)transform;
        baseScale = transform.localScale;
        if (graphic != null) baseColor = graphic.color;
        button.onClick.AddListener(() => Punch(4f));
    }

    void Awake() => Init();

    void OnEnable()
    {
        Init();
        hover = 1f;
        punchP = punchV = 0f;
        if (introOnEnable) Intro(0f);
    }

    void OnDisable()
    {
        hovered = pressed = false;
        introTime = shakeTime = flashTime = -1f;
        if (rt != null) rt.anchoredPosition -= new Vector2(shakeApplied, 0f);
        shakeApplied = 0f;
        transform.localScale = baseScale;
        if (graphic != null) graphic.color = baseColor;
    }

    /// <summary>Plays the pop-in again, optionally after a delay (use i * 0.05 to stagger a row of buttons).</summary>
    public void Intro(float delay = 0f)
    {
        Init();
        introDelay = delay;
        introTime = 0f;
        transform.localScale = Vector3.zero;
    }

    /// <summary>A springy bump. 4-6 is a nice click, 10 is dramatic.</summary>
    public void Punch(float impulse = 6f) => punchV = impulse;

    /// <summary>Wiggles side to side (a "no!").</summary>
    public void Shake(float amplitude = 14f)
    {
        shakeTime = 0f;
        shakeAmp = amplitude;
    }

    /// <summary>Tints the button a colour and fades back to normal.</summary>
    public void Flash(Color color)
    {
        flashColor = color;
        flashTime = 0f;
    }

    public void OnPointerEnter(PointerEventData e) => hovered = true;
    public void OnPointerExit(PointerEventData e) { hovered = false; pressed = false; }
    public void OnPointerDown(PointerEventData e) => pressed = true;
    public void OnPointerUp(PointerEventData e) => pressed = false;

    void Update()
    {
        float dt = Time.unscaledDeltaTime;

        // Hover / press: ease toward the target scale.
        float goal = !button.interactable ? 1f : pressed ? pressScale : hovered ? hoverScale : 1f;
        hover = Mathf.Lerp(hover, goal, 1f - Mathf.Exp(-20f * dt));

        // Click bump: a damped spring.
        punchV += (-300f * punchP - 14f * punchV) * dt;
        punchP += punchV * dt;

        // Pop-in.
        float intro = 1f;
        if (introTime >= 0f)
        {
            introTime += dt;
            float k = (introTime - introDelay) / introDuration;
            intro = k < 0f ? 0f : Juice.OutBack(k);
            if (k >= 1f) introTime = -1f;
        }

        transform.localScale = baseScale * ((hover + punchP) * intro);

        // Shake: moves by the change in offset each frame so it plays nicely with layout groups.
        if (shakeTime >= 0f)
        {
            shakeTime += dt;
            float k = shakeTime / ShakeDuration;
            float offset = k >= 1f ? 0f : Mathf.Sin(k * 40f) * shakeAmp * (1f - k);
            rt.anchoredPosition += new Vector2(offset - shakeApplied, 0f);
            shakeApplied = offset;
            if (k >= 1f) shakeTime = -1f;
        }

        // Flash.
        if (flashTime >= 0f && graphic != null)
        {
            flashTime += dt;
            float k = flashTime / FlashDuration;
            graphic.color = Color.Lerp(flashColor, baseColor, Mathf.Clamp01(k));
            if (k >= 1f) flashTime = -1f;
        }
    }
}
