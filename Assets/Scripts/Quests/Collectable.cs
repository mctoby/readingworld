using System.Collections;
using UnityEngine;

/// <summary>
/// A pickup that counts toward a quest. Needs a trigger collider; the player collects it by walking into it.
/// It pops into existence with a sparkle, and spins up, rises and shrinks away with a burst when collected.
/// </summary>
public class Collectable : MonoBehaviour
{
    [SerializeField] string itemId = "book";
    [SerializeField] string playerTag = "Player";
    [SerializeField] float spinSpeed = 90f;
    [SerializeField] float bobHeight = 0.03f;
    [SerializeField] float bobSpeed = 2f;

    [Header("Juice")]
    [Tooltip("One-shot particle effect played when this appears and when it is collected (e.g. SparkleBurst).")]
    [SerializeField] GameObject sparkleEffect;
    [SerializeField] float collectDuration = 0.35f;
    [SerializeField] float collectRise = 0.6f;

    Vector3 startPos;
    Vector3 baseScale = Vector3.one;
    bool scaleKnown;
    bool collected;

    void Awake()
    {
        baseScale = transform.localScale;
        scaleKnown = true;
    }

    void OnEnable()
    {
        startPos = transform.position;
        if (scaleKnown) StartCoroutine(Appear());
    }

    void Update()
    {
        if (collected) return;
        transform.Rotate(0f, spinSpeed * Time.deltaTime, 0f, Space.World);
        transform.position = startPos + Vector3.up * (Mathf.Sin(Time.time * bobSpeed) * bobHeight);
    }

    // Pop in with an overshoot and a sparkle, so the quest objects feel like they appear by magic.
    IEnumerator Appear()
    {
        Juice.Burst(sparkleEffect, transform.position);
        const float time = 0.5f;
        for (float t = 0f; t < time; t += Time.deltaTime)
        {
            transform.localScale = baseScale * Juice.OutBack(t / time);
            yield return null;
        }
        transform.localScale = baseScale;
    }

    void OnTriggerEnter(Collider other)
    {
        if (collected || !other.CompareTag(playerTag)) return;
        collected = true;
        StopAllCoroutines();
        QuestManager.Instance.AddItem(itemId);

        foreach (var c in GetComponentsInChildren<Collider>()) c.enabled = false;
        Juice.Burst(sparkleEffect, transform.position);
        StartCoroutine(Collect());
    }

    // Spin up, swell for a beat, then shoot upward while shrinking away.
    IEnumerator Collect()
    {
        Vector3 from = transform.position;
        for (float t = 0f; t < collectDuration; t += Time.deltaTime)
        {
            float k = t / collectDuration;
            transform.Rotate(0f, spinSpeed * (4f + 12f * k) * Time.deltaTime, 0f, Space.World);
            transform.position = from + Vector3.up * (collectRise * Juice.OutCubic(k));
            float swell = k < 0.3f ? 1f + 0.35f * (k / 0.3f) : Mathf.Lerp(1.35f, 0f, Juice.InCubic((k - 0.3f) / 0.7f));
            transform.localScale = baseScale * swell;
            yield return null;
        }
        Destroy(gameObject);
    }
}
