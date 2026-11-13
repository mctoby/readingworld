using UnityEngine;

/// <summary>
/// A pickup that counts toward a quest. Needs a trigger collider; the player collects it by walking into it.
/// </summary>
public class Collectable : MonoBehaviour
{
    [SerializeField] string itemId = "book";
    [SerializeField] string playerTag = "Player";
    [SerializeField] float spinSpeed = 90f;
    [SerializeField] float bobHeight = 0.03f;
    [SerializeField] float bobSpeed = 2f;

    Vector3 startPos;

    void OnEnable() => startPos = transform.position;

    void Update()
    {
        transform.Rotate(0f, spinSpeed * Time.deltaTime, 0f, Space.World);
        transform.position = startPos + Vector3.up * (Mathf.Sin(Time.time * bobSpeed) * bobHeight);
    }

    void OnTriggerEnter(Collider other)
    {
        if (!other.CompareTag(playerTag)) return;
        QuestManager.Instance.AddItem(itemId);
        Destroy(gameObject);
    }
}
