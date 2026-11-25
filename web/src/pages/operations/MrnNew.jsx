import { useNavigate } from 'react-router-dom';
import MrnForm from '../../components/MrnForm.jsx';
import { Card, Icon } from '../../ui.jsx';

export default function MrnNew() {
  const navigate = useNavigate();

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Raise a material request</h1>
          <p>Only your assigned sites are listed. Quantities, UOM and remarks only — no rates.</p>
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={() => navigate('/mrn')}>
            <Icon name="return" size={15} /> Back to requests
          </button>
        </div>
      </div>

      <Card title="New MRN" subtitle="The store manager will approve, part-approve or reject it.">
        <MrnForm onDone={(mrn) => navigate(`/mrn/${mrn.id}`)} onCancel={() => navigate('/mrn')} />
      </Card>
    </div>
  );
}
