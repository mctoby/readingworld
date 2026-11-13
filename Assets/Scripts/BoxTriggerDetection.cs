using UnityEngine;
using UnityEngine.Events;
public class BoxTriggerDetection : MonoBehaviour
{
    public bool TriggerOnce;
    public UnityEvent OnTriggerEnterEvent;
    public UnityEvent OnTriggerExitEvent;

    public string TriggerTag = "Player";
    

    void OnTriggerEnter(Collider other){
        if(other.CompareTag(TriggerTag)){
            if(TriggerOnce){
                OnTriggerEnterEvent.Invoke();
                Destroy(this);
            } else {
                OnTriggerEnterEvent.Invoke();
            }
        }
    }

    void OnTriggerExit(Collider other){
        if(other.CompareTag(TriggerTag)){
            OnTriggerExitEvent.Invoke();
        }
    }

}
