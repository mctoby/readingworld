using System.Collections;
using System.Collections.Generic;
using Unity.Cinemachine;
using UnityEngine;

/// <summary>
/// Hides the library's books at start. When a quest is completed, reveals as many books as the quest
/// required, one at a time, while a Cinemachine camera frames the shelves so you can watch them arrive.
/// </summary>
public class LibraryManager : MonoBehaviour
{
    enum CameraSide { TowardPlayer, LocalForward, LocalBack }

    [Header("Books")]
    [Tooltip("Books hidden at start and revealed in this order. If empty, child objects named 'Book' are used, in hierarchy order.")]
    [SerializeField] List<GameObject> books = new();

    [Tooltip("Only this quest adds books. Leave empty to react to every quest (each adds its Reward Books).")]
    [SerializeField] string questId = "";

    [Header("Camera")]
    [Tooltip("Inactive Cinemachine camera (child of this object). Enabled while the books arrive; position is set automatically.")]
    [SerializeField] CinemachineCamera libraryCamera;

    [Tooltip("Which side of the bookcase the camera films from. TowardPlayer picks whichever side the player is on.")]
    [SerializeField] CameraSide cameraSide = CameraSide.TowardPlayer;

    [Tooltip("How much empty space to leave around the books (1 = tight, 1.5 = roomy).")]
    [SerializeField] float framingPadding = 1.5f;

    [Tooltip("Camera angle above horizontal, in degrees.")]
    [SerializeField] float cameraElevation = 8f;

    [Header("Reveal")]
    [SerializeField] float revealInterval = 0.8f;
    [SerializeField] float slideDistance = 0.3f;
    [SerializeField] float slideDuration = 0.5f;
    [SerializeField] float holdTime = 1.5f;

    Bounds[] bookBounds;
    int nextBook;
    readonly Queue<Vector2Int> queue = new();   // (first book index, count)
    bool running;
    bool holdingLock;

    void Awake()
    {
        if (books.Count == 0)
        {
            foreach (Transform child in transform)
                if (child.name == "Book" || child.name.StartsWith("Book ("))
                    books.Add(child.gameObject);
        }

        // Remember where each book sits (its renderer bounds) so the camera can frame it later,
        // then hide it.
        bookBounds = new Bounds[books.Count];
        for (int i = 0; i < books.Count; i++)
        {
            bookBounds[i] = CalculateBounds(books[i]);
            books[i].SetActive(false);
        }

        if (libraryCamera != null) libraryCamera.gameObject.SetActive(false);
    }

    void OnEnable() => QuestManager.QuestCompleted += OnQuestCompleted;

    void OnDisable()
    {
        QuestManager.QuestCompleted -= OnQuestCompleted;
        if (holdingLock)
        {
            holdingLock = false;
            PlayerControlLock.Unlock();
        }
    }

    void OnQuestCompleted(QuestData quest)
    {
        if (!string.IsNullOrEmpty(questId) && quest.id != questId) return;
        AddBooks(quest.RewardBooks);
    }

    /// <summary>Reveals the next <paramref name="count"/> books with a camera sequence.</summary>
    public void AddBooks(int count)
    {
        int n = Mathf.Min(count, books.Count - nextBook);
        if (n < count)
            Debug.LogWarning($"{name}: only {Mathf.Max(n, 0)} of {count} books could be added (not enough Book objects).", this);
        if (n <= 0) return;

        queue.Enqueue(new Vector2Int(nextBook, n));
        nextBook += n;
        if (!running) StartCoroutine(RunQueue());
    }

    IEnumerator RunQueue()
    {
        running = true;
        PlayerControlLock.Lock();
        holdingLock = true;

        while (queue.Count > 0)
        {
            var job = queue.Dequeue();
            yield return RevealSequence(job.x, job.y);
        }

        // Let the camera blend back to the player before handing control back.
        yield return new WaitForSeconds(BlendTime());
        if (holdingLock)
        {
            holdingLock = false;
            PlayerControlLock.Unlock();
        }
        running = false;
    }

    IEnumerator RevealSequence(int first, int count)
    {
        // Frame all the books that are about to arrive.
        var framing = bookBounds[first];
        for (int i = first + 1; i < first + count; i++) framing.Encapsulate(bookBounds[i]);
        Vector3 towardCamera = PositionCamera(framing);

        if (libraryCamera != null) libraryCamera.gameObject.SetActive(true);
        yield return new WaitForSeconds(BlendTime());

        for (int i = first; i < first + count; i++)
        {
            yield return SlideIn(books[i], towardCamera);
            yield return new WaitForSeconds(revealInterval);
        }

        yield return new WaitForSeconds(holdTime);

        if (libraryCamera != null) libraryCamera.gameObject.SetActive(false);
    }

    // Slides a book in from in front of the shelf, so it looks like it's being put there.
    IEnumerator SlideIn(GameObject book, Vector3 towardCamera)
    {
        var t = book.transform;
        Vector3 end = t.position;
        Vector3 start = end + towardCamera * slideDistance + Vector3.up * (slideDistance * 0.3f);
        t.position = start;
        book.SetActive(true);

        for (float time = 0f; time < slideDuration; time += Time.deltaTime)
        {
            float k = time / slideDuration;
            k = 1f - (1f - k) * (1f - k) * (1f - k);   // ease out
            t.position = Vector3.LerpUnclamped(start, end, k);
            yield return null;
        }
        t.position = end;
    }

    // Places the library camera so the whole of 'target' is in view. Returns the horizontal direction
    // from the books toward the camera.
    Vector3 PositionCamera(Bounds target)
    {
        Vector3 side = transform.forward;
        switch (cameraSide)
        {
            case CameraSide.LocalBack:
                side = -transform.forward;
                break;
            case CameraSide.TowardPlayer:
                var player = GameObject.FindGameObjectWithTag("Player");
                if (player != null && Vector3.Dot(player.transform.position - target.center, transform.forward) < 0f)
                    side = -transform.forward;
                break;
        }

        if (libraryCamera == null) return side;

        float el = cameraElevation * Mathf.Deg2Rad;
        Vector3 dir = (side * Mathf.Cos(el) + Vector3.up * Mathf.Sin(el)).normalized;   // books -> camera
        Quaternion rot = Quaternion.LookRotation(-dir, Vector3.up);

        // Work out how far back the camera must be for every corner of the bounds to fit on screen.
        float vFov = libraryCamera.Lens.FieldOfView * Mathf.Deg2Rad;
        float halfV = Mathf.Tan(vFov * 0.5f);
        float aspect = Screen.height > 0 ? (float)Screen.width / Screen.height : 16f / 9f;
        float halfH = halfV * aspect;

        float dist = 0.6f;
        Quaternion inv = Quaternion.Inverse(rot);
        Vector3 e = target.extents;
        for (int i = 0; i < 8; i++)
        {
            var corner = new Vector3((i & 1) == 0 ? -e.x : e.x, (i & 2) == 0 ? -e.y : e.y, (i & 4) == 0 ? -e.z : e.z);
            Vector3 rel = inv * corner;   // x right, y up, z away from camera
            dist = Mathf.Max(dist, Mathf.Abs(rel.x) * framingPadding / halfH - rel.z);
            dist = Mathf.Max(dist, Mathf.Abs(rel.y) * framingPadding / halfV - rel.z);
        }

        libraryCamera.transform.SetPositionAndRotation(target.center + dir * dist, rot);
        return side;
    }

    // Wait long enough for Cinemachine to finish blending to / from the library camera.
    float BlendTime()
    {
        var brain = FindAnyObjectByType<CinemachineBrain>();
        return (brain != null ? brain.DefaultBlend.Time : 1.5f) + 0.1f;
    }

    static Bounds CalculateBounds(GameObject go)
    {
        var renderers = go.GetComponentsInChildren<Renderer>(true);
        if (renderers.Length == 0) return new Bounds(go.transform.position, Vector3.one * 0.2f);
        var b = renderers[0].bounds;
        for (int i = 1; i < renderers.Length; i++) b.Encapsulate(renderers[i].bounds);
        return b;
    }
}
