using TMPro;
using UnityEngine;
using UnityEngine.Serialization;

/// <summary>
/// One row in the glossary list: the collected word and what it means.
/// The glossary copies its inactive "EntryTemplate" once per word, so change that template to change every row.
/// </summary>
public class GlossaryEntry : MonoBehaviour
{
    [SerializeField] TMP_Text wordText;

    [Tooltip("Shows the word's definition. If the definitions file has none, the sentence the word was found in is shown instead.")]
    [FormerlySerializedAs("sentenceText")]
    [SerializeField] TMP_Text definitionText;

    [Tooltip("Used only when a word has no definition. {0} is who said it, {1} is the sentence.")]
    [FormerlySerializedAs("sentenceFormat")]
    [SerializeField] string fallbackFormat = "{0}: \"{1}\"";

    public void Set(WordGlossary.Entry entry, string definition)
    {
        if (wordText != null) wordText.text = entry.word;
        if (definitionText == null) return;

        if (!string.IsNullOrEmpty(definition))
            definitionText.text = definition;
        else if (string.IsNullOrEmpty(entry.speaker))
            definitionText.text = entry.sentence;
        else
            definitionText.text = string.Format(fallbackFormat, entry.speaker, entry.sentence);
    }
}
