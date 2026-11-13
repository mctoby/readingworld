using System.Collections;
using UnityEngine;

/// <summary>
/// Juice for a UI panel: it pops in (scale with overshoot + fade) whenever it is enabled, can pop out with
/// <see cref="Hide"/>, and can be given a springy <see cref="Punch"/> to draw attention to a change.
/// Uses unscaled time, so it still animates if the game is paused.
/// </summary>
public class PopIn : MonoBehaviour
{
    [SerializeField] float fromScale = 0.8f;
    [SerializeField] float duration = 0.35f;
    [SerializeField] float delay = 0f;
    [Tooltip("Scale the panel shrinks to while hiding (1 = just fade).")]
    [SerializeField] float hideScale = 0.9f;

    CanvasGroup group;
    Vector3 baseScale = Vector3.one;
    bool init;
    Coroutine routine;
    float punchP, punchV;

    void Init()
    {
        if (init) return;
        init = true;
        baseScale = transform.localScale;
        group = GetComponent<CanvasGroup>();
        if (group == null) group = gameObject.AddComponent<CanvasGroup>();
    }

    void OnEnable() => Play();

    void OnDisable()
    {
        routine = null;
        if (!init) return;
        transform.localScale = baseScale;
        group.alpha = 1f;
        punchP = punchV = 0f;
    }

    /// <summary>Shows the panel (activating it if needed) with the pop-in animation.</summary>
    public void Show()
    {
        if (!gameObject.activeSelf) gameObject.SetActive(true);   // OnEnable plays the intro
        else Play();
    }

    void Play()
    {
        Init();
        if (routine != null) StopCoroutine(routine);
        routine = StartCoroutine(Intro());
    }

    /// <summary>Pops the panel out, then deactivates it.</summary>
    public void Hide()
    {
        if (!gameObject.activeInHierarchy) { gameObject.SetActive(false); return; }
        Init();
        if (routine != null) StopCoroutine(routine);
        routine = StartCoroutine(Outro());
    }

    /// <summary>A quick springy bump in scale. amount ~0.05 is subtle, 0.2 is bold.</summary>
    public void Punch(float amount = 0.1f)
    {
        Init();
        punchV = amount * 17f;   // the spring in Update turns this impulse into a bump of roughly 'amount'
    }

    IEnumerator Intro()
    {
        group.alpha = 0f;
        transform.localScale = baseScale * fromScale;
        for (float t = 0f; t < delay; t += Time.unscaledDeltaTime) yield return null;

        for (float t = 0f; t < duration; t += Time.unscaledDeltaTime)
        {
            float k = t / duration;
            group.alpha = Mathf.Clamp01(k * 3f);
            transform.localScale = baseScale * Mathf.LerpUnclamped(fromScale, 1f, Juice.OutBack(k));
            yield return null;
        }
        group.alpha = 1f;
        transform.localScale = baseScale;
        routine = null;
    }

    IEnumerator Outro()
    {
        const float time = 0.15f;
        for (float t = 0f; t < time; t += Time.unscaledDeltaTime)
        {
            float k = Juice.InCubic(t / time);
            group.alpha = 1f - k;
            transform.localScale = baseScale * Mathf.Lerp(1f, hideScale, k);
            yield return null;
        }
        routine = null;
        gameObject.SetActive(false);   // OnDisable restores scale and alpha for next time
    }

    void Update()
    {
        if (routine != null || (punchP == 0f && punchV == 0f)) return;

        float dt = Time.unscaledDeltaTime;
        punchV += (-300f * punchP - 14f * punchV) * dt;
        punchP += punchV * dt;
        if (Mathf.Abs(punchP) < 0.0005f && Mathf.Abs(punchV) < 0.01f) punchP = punchV = 0f;
        transform.localScale = baseScale * (1f + punchP);
    }
}
